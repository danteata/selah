/*!
 * Windows frame source for NDI output.
 *
 * The macOS side (`capture.rs`) captures the live output window with
 * ScreenCaptureKit. Windows had no frame source at all: `ndi_start_output`
 * created the sender and returned, so receivers discovered "Selah Live Output"
 * and showed a black frame forever.
 *
 * This uses Windows.Graphics.Capture (WGC) rather than GDI `BitBlt`/`PrintWindow`
 * because the live output is a WebView2 window, which draws through the GPU
 * compositor — GDI copies of such windows commonly come back black, i.e. the very
 * symptom being fixed. WGC needs Windows 10 1903+.
 *
 * Shape of the loop:
 *   1. wait for a window whose title contains "Live Output" (the live window is
 *      titled "Selah - Live Output"), retrying so NDI can be armed first;
 *   2. build a D3D11 device and a free-threaded capture frame pool for it;
 *   3. poll `TryGetNextFrame`, copy each texture into a CPU-readable staging
 *      texture, and push the BGRA rows into the shared `NdiSender`;
 *   4. re-send the last frame while nothing changes, because WGC only produces a
 *      frame when the window's content changes and a receiver that connects
 *      during a static slide would otherwise get nothing to show.
 *
 * Audio is not captured here — WGC is video only. `include_audio` is honoured on
 * macOS only.
 */

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows::core::{Interface, Result as WinResult};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};

use super::sender::NdiSender;
use super::types::NdiOutputConfig;

/// Substring of the live output window's title ("Selah - Live Output").
const LIVE_WINDOW_TITLE: &str = "Live Output";

/// How long a static slide may go without a frame before the last one is sent
/// again, so late-joining receivers have a picture. 100 ms ≈ 10 fps when idle.
const IDLE_RESEND: Duration = Duration::from_millis(100);

pub fn start_capture(
    _config: &NdiOutputConfig,
    sender: Arc<NdiSender>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        if let Err(e) = capture_loop(sender, &stop) {
            eprintln!("NDI capture error: {e}");
        }
    });

    Ok(())
}

/// `stop` is really "keep running" — set true on start, false on stop. Named for
/// the macOS path it is shared with.
fn capture_loop(sender: Arc<NdiSender>, stop: &Arc<AtomicBool>) -> Result<(), String> {
    eprintln!("NDI capture: waiting for '{LIVE_WINDOW_TITLE}' window...");

    let mut waited_logged = false;
    while stop.load(Ordering::SeqCst) {
        match find_live_window() {
            Some(hwnd) => {
                eprintln!("NDI capture: found '{LIVE_WINDOW_TITLE}' window");
                waited_logged = false;
                if let Err(e) = run_capture(hwnd, sender.clone(), stop) {
                    eprintln!("NDI capture stream ended: {e:?}, will retry if the window reappears...");
                }
                if stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            None => {
                if !waited_logged {
                    eprintln!("NDI capture: waiting for '{LIVE_WINDOW_TITLE}' window...");
                    waited_logged = true;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }

    eprintln!("NDI capture loop exited");
    Ok(())
}

struct FoundWindow {
    hwnd: Option<HWND>,
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let found = &mut *(lparam.0 as *mut FoundWindow);

    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }

    let mut text = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut text);
    if len > 0 {
        let title = String::from_utf16_lossy(&text[..len as usize]);
        if title.contains(LIVE_WINDOW_TITLE) {
            found.hwnd = Some(hwnd);
            return BOOL(0); // stop enumerating
        }
    }

    TRUE
}

fn find_live_window() -> Option<HWND> {
    let mut found = FoundWindow { hwnd: None };
    // EnumWindows returns Err when the callback stops it early, which is exactly
    // what a hit does — so the result is ignored in favour of `found`.
    unsafe {
        let _ = EnumWindows(
            Some(enum_window),
            LPARAM(&mut found as *mut FoundWindow as isize),
        );
    }
    found.hwnd
}

fn create_d3d_device() -> WinResult<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;

    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            None,
            // BGRA support is required to share the device with WinRT.
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }

    Ok((device.unwrap(), context.unwrap()))
}

fn capture_item_for(hwnd: HWND) -> WinResult<GraphicsCaptureItem> {
    // GraphicsCaptureItem has no public constructor for an HWND; the interop
    // interface on its activation factory is the documented way in.
    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    unsafe { interop.CreateForWindow(hwnd) }
}

fn run_capture(hwnd: HWND, sender: Arc<NdiSender>, stop: &Arc<AtomicBool>) -> WinResult<()> {
    let (device, context) = create_d3d_device()?;
    let dxgi_device: IDXGIDevice = device.cast()?;
    let winrt_device = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)? };
    let winrt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice = winrt_device.cast()?;

    let item = capture_item_for(hwnd)?;
    let mut size = item.Size()?;

    let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )?;
    let session = frame_pool.CreateCaptureSession(&item)?;
    // Both are best-effort: cursor capture is Windows 10 2004+, the border is
    // Windows 11. An older build just keeps the default.
    let _ = session.SetIsCursorCaptureEnabled(false);
    let _ = session.SetIsBorderRequired(false);
    session.StartCapture()?;

    eprintln!("NDI capture started: {}x{}", size.Width, size.Height);

    let mut staging: Option<(ID3D11Texture2D, u32, u32)> = None;
    let mut last_frame: Vec<u8> = Vec::new();
    let mut last_dims = (0u32, 0u32, 0usize);
    let mut last_sent = Instant::now() - IDLE_RESEND;
    let mut frame_count: u64 = 0;

    while stop.load(Ordering::SeqCst) {
        let frame = frame_pool.TryGetNextFrame();

        match frame {
            Ok(frame) => {
                let content_size = frame.ContentSize()?;
                if content_size.Width != size.Width || content_size.Height != size.Height {
                    // The window was resized; the pool must be rebuilt at the new
                    // size or every later frame is letterboxed into the old one.
                    size = content_size;
                    staging = None;
                    frame_pool.Recreate(
                        &winrt_device,
                        DirectXPixelFormat::B8G8R8A8UIntNormalized,
                        2,
                        size,
                    )?;
                    continue;
                }

                let surface = frame.Surface()?;
                let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
                let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };

                let (width, height) = (size.Width.max(0) as u32, size.Height.max(0) as u32);
                if width == 0 || height == 0 {
                    continue;
                }

                // A staging texture is the only way to get GPU pixels onto the
                // CPU; reused across frames unless the size changes.
                if staging.as_ref().map(|(_, w, h)| (*w, *h)) != Some((width, height)) {
                    staging = Some((create_staging_texture(&device, width, height)?, width, height));
                }
                let (staging_texture, _, _) = staging.as_ref().unwrap();

                unsafe {
                    context.CopyResource(staging_texture, &texture);

                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                    context.Map(staging_texture, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;

                    let stride = mapped.RowPitch as usize;
                    let len = stride * height as usize;
                    let pixels = std::slice::from_raw_parts(mapped.pData as *const u8, len);

                    last_frame.clear();
                    last_frame.extend_from_slice(pixels);
                    last_dims = (width, height, stride);

                    context.Unmap(staging_texture, 0);
                }

                if let Err(e) = sender.send_frame(&last_frame, width, height, last_dims.2 as i32) {
                    eprintln!("NDI send_frame error: {e}");
                    break;
                }
                last_sent = Instant::now();
                frame_count += 1;
                if frame_count <= 5 || frame_count % 300 == 0 {
                    eprintln!("NDI frame #{frame_count}: {width}x{height} stride={stride}", stride = last_dims.2);
                }
            }
            // No new frame: the slide is static. Repeat the last one at a low rate
            // so a receiver connecting mid-slide sees it instead of black.
            Err(_) => {
                if !last_frame.is_empty() && last_sent.elapsed() >= IDLE_RESEND {
                    let (width, height, stride) = last_dims;
                    if sender
                        .send_frame(&last_frame, width, height, stride as i32)
                        .is_err()
                    {
                        break;
                    }
                    last_sent = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(8));
            }
        }
    }

    let _ = session.Close();
    let _ = frame_pool.Close();
    eprintln!("NDI capture stopped after {frame_count} frames");
    Ok(())
}

fn create_staging_texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> WinResult<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };

    let mut texture: Option<ID3D11Texture2D> = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture))? };
    Ok(texture.unwrap())
}

/// Whether this machine can do WGC at all. `GraphicsCaptureSession::IsSupported`
/// is the documented probe and returns false on Windows builds before 1903.
pub fn is_supported() -> bool {
    windows::Graphics::Capture::GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_window_title_matches_the_window_the_app_creates() {
        // multi_monitor::window_manager creates it with this title; if that
        // changes, capture silently waits forever for a window that never comes.
        assert!("Selah - Live Output".contains(LIVE_WINDOW_TITLE));
    }

    #[test]
    fn idle_resend_keeps_a_static_slide_alive_on_late_receivers() {
        // WGC only emits on change, so anything above a couple of seconds would
        // leave a late-joining receiver black through a whole static slide.
        assert!(IDLE_RESEND <= Duration::from_millis(200));
    }
}
