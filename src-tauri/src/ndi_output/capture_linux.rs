/*!
 * Linux frame source for NDI output.
 *
 * Third of the three capture backends, alongside ScreenCaptureKit on macOS
 * (`capture.rs`) and Windows.Graphics.Capture on Windows (`capture_windows.rs`).
 * All three find the live output window, grab its pixels and push them into the
 * shared `NdiSender`; only the OS plumbing differs.
 *
 * X11, via the XComposite + MIT-SHM pair:
 *   - XComposite's `NameWindowPixmap` gives a drawable holding the window's full
 *     contents, so a covered or partly offscreen projector window still captures
 *     correctly. Reading the window drawable directly (the fallback when
 *     COMPOSITE is missing) leaves obscured regions undefined.
 *   - MIT-SHM puts the frame in shared memory, so a 1080p grab is a memcpy the
 *     server does for us rather than 8 MB pushed through the X socket 30 times a
 *     second.
 *
 * `x11-dl` is already in the tree via tao/tauri and dlopens libX11 and libXext
 * at run time; the four XComposite entry points it lacks are loaded the same way
 * (see `Composite`). So this adds no build-time dependency and nothing new to
 * bundle in the AppImage — a machine without libXcomposite just falls back.
 *
 * Wayland: a natively-Wayland Selah has no X11 window to capture, and this
 * reports that with the GDK_BACKEND=x11 hint rather than sending black. The
 * PipeWire/xdg-desktop-portal route is the real Wayland answer and is not built.
 *
 * Audio is not captured here — macOS is still the only backend that does audio.
 */

use std::ffi::{c_char, c_int, c_uint, c_ulong, c_void, CStr, CString};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use x11_dl::xlib::{self, Display, Visual, Window, XImage, Xlib};
use x11_dl::xshm::{XShmSegmentInfo, Xext};

use super::ndi_lib::FOURCC_BGRX;
use super::sender::NdiSender;
use super::types::NdiOutputConfig;

/// Substring of the live output window's title ("Selah - Live Output").
const LIVE_WINDOW_TITLE: &str = "Live Output";

/// Frame interval. X11 has no "content changed" signal here, so frames are
/// polled at a fixed rate rather than driven by damage events.
const FRAME_INTERVAL: Duration = Duration::from_millis(33);

const COMPOSITE_REDIRECT_AUTOMATIC: c_int = 0;

/// Last X protocol error code, recorded by our handler. Xlib's default handler
/// calls exit() on any error, which would take the whole app down for something
/// as ordinary as a window closing mid-capture.
static LAST_X_ERROR: AtomicI32 = AtomicI32::new(0);

unsafe extern "C" fn x_error_handler(_dpy: *mut Display, event: *mut xlib::XErrorEvent) -> c_int {
    if !event.is_null() {
        LAST_X_ERROR.store((*event).error_code as i32, Ordering::SeqCst);
    }
    0
}

fn take_x_error() -> i32 {
    LAST_X_ERROR.swap(0, Ordering::SeqCst)
}

/// The XComposite entry points we need. x11-dl has no xcomposite module, so the
/// four functions are pulled out of libXcomposite by hand — the same
/// dlopen-and-look-up approach `ndi_lib` uses for the NDI runtime, which also
/// means no new build-time dependency and nothing extra to bundle.
struct Composite {
    _lib: libloading::Library,
    query_extension: unsafe extern "C" fn(*mut Display, *mut c_int, *mut c_int) -> c_int,
    redirect_window: unsafe extern "C" fn(*mut Display, Window, c_int),
    unredirect_window: unsafe extern "C" fn(*mut Display, Window, c_int),
    name_window_pixmap: unsafe extern "C" fn(*mut Display, Window) -> c_ulong,
}

impl Composite {
    fn open() -> Option<Self> {
        for name in ["libXcomposite.so.1", "libXcomposite.so"] {
            let lib = match unsafe { libloading::Library::new(name) } {
                Ok(lib) => lib,
                Err(_) => continue,
            };
            unsafe {
                let query_extension = *lib.get(b"XCompositeQueryExtension\0").ok()?;
                let redirect_window = *lib.get(b"XCompositeRedirectWindow\0").ok()?;
                let unredirect_window = *lib.get(b"XCompositeUnredirectWindow\0").ok()?;
                let name_window_pixmap = *lib.get(b"XCompositeNameWindowPixmap\0").ok()?;
                return Some(Self {
                    _lib: lib,
                    query_extension,
                    redirect_window,
                    unredirect_window,
                    name_window_pixmap,
                });
            }
        }
        None
    }
}

pub struct Frame<'a> {
    pub data: &'a [u8],
    pub width: u32,
    pub height: u32,
    pub stride: usize,
}

/// Fail fast, before a sender is announced, when this machine can't be captured.
/// Whether the live output window itself exists is checked by the caller.
pub fn preflight() -> Result<(), String> {
    let xlib = Xlib::open().map_err(|e| format!("libX11 is not available: {e}"))?;
    let xext = Xext::open().map_err(|e| format!("libXext (MIT-SHM) is not available: {e}"))?;

    unsafe {
        let display = (xlib.XOpenDisplay)(ptr::null());
        if display.is_null() {
            return Err(wayland_hint(
                "NDI output on Linux captures an X11 window, and there's no X display to read.",
            ));
        }
        let shm = (xext.XShmQueryExtension)(display);
        (xlib.XCloseDisplay)(display);
        if shm == 0 {
            return Err("This X server has no MIT-SHM extension, which NDI capture needs.".to_string());
        }
    }

    Ok(())
}

/// Adds the XWayland hint when the session looks like Wayland, where the real
/// problem is that Selah's windows aren't X11 windows at all.
fn wayland_hint(message: &str) -> String {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        format!(
            "{message} This looks like a Wayland session — start Selah with GDK_BACKEND=x11 so its \
             windows run under XWayland, which NDI can capture."
        )
    } else {
        message.to_string()
    }
}

pub fn start_capture(
    _config: &NdiOutputConfig,
    sender: Arc<NdiSender>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    // Surface the machine-level problems now; the window itself may legitimately
    // appear later, which the loop waits for.
    preflight()?;

    std::thread::spawn(move || {
        capture_loop(sender, &stop);
    });

    Ok(())
}

/// `stop` is really "keep running" — true on start, false on stop, matching the
/// flag the other two backends share.
fn capture_loop(sender: Arc<NdiSender>, stop: &Arc<AtomicBool>) {
    let mut waited_logged = false;

    while stop.load(Ordering::SeqCst) {
        match X11WindowCapture::open(LIVE_WINDOW_TITLE) {
            Ok(capture) => {
                eprintln!("NDI capture: found '{LIVE_WINDOW_TITLE}' window");
                waited_logged = false;
                if let Err(e) = pump_frames(capture, &sender, stop) {
                    eprintln!("NDI capture stream ended: {e}, will retry if the window reappears...");
                }
                if stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            Err(e) => {
                if !waited_logged {
                    eprintln!("NDI capture: waiting for the live output window ({e})");
                    waited_logged = true;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }

    eprintln!("NDI capture loop exited");
}

fn pump_frames(
    mut capture: X11WindowCapture,
    sender: &Arc<NdiSender>,
    stop: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut frame_count: u64 = 0;

    while stop.load(Ordering::SeqCst) {
        let started = Instant::now();
        let frame = capture.capture()?;

        // BGRX, not BGRA: an X11 depth-24 window leaves the fourth byte at zero,
        // and a receiver honouring that alpha would composite the whole frame
        // away to black.
        sender.send_frame_with_fourcc(frame.data, frame.width, frame.height, frame.stride as i32, FOURCC_BGRX)?;

        frame_count += 1;
        if frame_count <= 5 || frame_count % 300 == 0 {
            eprintln!(
                "NDI frame #{frame_count}: {}x{} stride={}",
                frame.width, frame.height, frame.stride
            );
        }

        if let Some(remaining) = FRAME_INTERVAL.checked_sub(started.elapsed()) {
            std::thread::sleep(remaining);
        }
    }

    eprintln!("NDI capture stopped after {frame_count} frames");
    Ok(())
}

pub struct X11WindowCapture {
    xlib: Xlib,
    xext: Xext,
    composite: Option<Composite>,
    display: *mut Display,
    window: Window,
    visual: *mut Visual,
    depth: c_int,
    /// Set when we (rather than a compositing WM) redirected the window.
    we_redirected: bool,
    pixmap: c_ulong,
    image: *mut XImage,
    seg: XShmSegmentInfo,
    width: u32,
    height: u32,
}

impl X11WindowCapture {
    /// Open the display and find a viewable window whose title contains `title`.
    pub fn open(title: &str) -> Result<Self, String> {
        let xlib = Xlib::open().map_err(|e| format!("libX11 unavailable: {e}"))?;
        let xext = Xext::open().map_err(|e| format!("libXext (MIT-SHM) unavailable: {e}"))?;

        unsafe {
            (xlib.XSetErrorHandler)(Some(x_error_handler));

            let display = (xlib.XOpenDisplay)(ptr::null());
            if display.is_null() {
                return Err(
                    "No X display. NDI output on Linux captures an X11 window, so Selah has to \
                     run under X11 or XWayland — try starting it with GDK_BACKEND=x11."
                        .to_string(),
                );
            }

            if (xext.XShmQueryExtension)(display) == 0 {
                (xlib.XCloseDisplay)(display);
                return Err("This X server has no MIT-SHM extension, which NDI capture needs.".to_string());
            }

            let root = (xlib.XDefaultRootWindow)(display);
            let window = match find_window(&xlib, display, root, title) {
                Some(window) => window,
                None => {
                    (xlib.XCloseDisplay)(display);
                    return Err(format!("No X11 window titled '{title}' is open."));
                }
            };

            let mut attrs: xlib::XWindowAttributes = std::mem::zeroed();
            if (xlib.XGetWindowAttributes)(display, window, &mut attrs) == 0 {
                (xlib.XCloseDisplay)(display);
                return Err("Could not read the window's attributes.".to_string());
            }

            let composite = Composite::open();
            let mut we_redirected = false;
            if let Some(composite) = composite.as_ref() {
                let (mut major, mut minor) = (0, 0);
                if ((composite.query_extension)(display, &mut major, &mut minor)) != 0 {
                    take_x_error();
                    (composite.redirect_window)(display, window, COMPOSITE_REDIRECT_AUTOMATIC);
                    (xlib.XSync)(display, 0);
                    // BadAccess just means a compositing window manager already
                    // redirects this window — its pixmap is still nameable, so
                    // capture works; we simply must not un-redirect on the way out.
                    we_redirected = take_x_error() == 0;
                }
            }

            let mut capture = Self {
                xlib,
                xext,
                composite,
                display,
                window,
                visual: attrs.visual,
                depth: attrs.depth,
                we_redirected,
                pixmap: 0,
                image: ptr::null_mut(),
                seg: std::mem::zeroed(),
                width: 0,
                height: 0,
            };

            let (width, height) = capture.window_size()?;
            capture.rebuild(width, height)?;
            Ok(capture)
        }
    }

    fn window_size(&self) -> Result<(u32, u32), String> {
        unsafe {
            let mut root = 0;
            let (mut x, mut y) = (0, 0);
            let (mut width, mut height, mut border, mut depth) = (0, 0, 0, 0);
            take_x_error();
            let ok = (self.xlib.XGetGeometry)(
                self.display,
                self.window,
                &mut root,
                &mut x,
                &mut y,
                &mut width,
                &mut height,
                &mut border,
                &mut depth,
            );
            if ok == 0 || take_x_error() != 0 {
                return Err("The captured window has gone away.".to_string());
            }
            Ok((width, height))
        }
    }

    /// (Re)create the named pixmap and the shared-memory image. Called on open
    /// and whenever the window is resized — the named pixmap is tied to the
    /// window's size, so a stale one silently keeps handing back the old frame.
    fn rebuild(&mut self, width: u32, height: u32) -> Result<(), String> {
        self.release_buffers();

        if width == 0 || height == 0 {
            return Err("The window has no area to capture.".to_string());
        }

        unsafe {
            if let Some(composite) = self.composite.as_ref() {
                take_x_error();
                let pixmap = (composite.name_window_pixmap)(self.display, self.window);
                (self.xlib.XSync)(self.display, 0);
                if take_x_error() == 0 && pixmap != 0 {
                    self.pixmap = pixmap;
                }
            }

            let image = (self.xext.XShmCreateImage)(
                self.display,
                self.visual,
                self.depth as c_uint,
                xlib::ZPixmap,
                ptr::null_mut(),
                &mut self.seg,
                width,
                height,
            );
            if image.is_null() {
                return Err("XShmCreateImage failed.".to_string());
            }

            let size = (*image).bytes_per_line as usize * (*image).height as usize;
            let shmid = libc::shmget(libc::IPC_PRIVATE, size, libc::IPC_CREAT | 0o600);
            if shmid < 0 {
                (self.xlib.XDestroyImage)(image);
                return Err("shmget failed — no System V shared memory available.".to_string());
            }
            let addr = libc::shmat(shmid, ptr::null(), 0);
            if addr as isize == -1 {
                libc::shmctl(shmid, libc::IPC_RMID, ptr::null_mut());
                (self.xlib.XDestroyImage)(image);
                return Err("shmat failed.".to_string());
            }

            self.seg.shmid = shmid;
            self.seg.shmaddr = addr as *mut c_char;
            self.seg.readOnly = 0;
            (*image).data = self.seg.shmaddr;
            self.image = image;

            take_x_error();
            (self.xext.XShmAttach)(self.display, &mut self.seg);
            (self.xlib.XSync)(self.display, 0);
            if take_x_error() != 0 {
                return Err("The X server refused to attach the shared memory segment.".to_string());
            }
            // Mark for destruction now that the server has it mapped: the segment
            // then disappears with the last detach even if we crash.
            libc::shmctl(shmid, libc::IPC_RMID, ptr::null_mut());

            self.validate_format()?;
            self.width = width;
            self.height = height;
            Ok(())
        }
    }

    /// Refuse anything that isn't 32-bit little-endian BGRX/BGRA, rather than
    /// sending a colour-swapped or garbled feed.
    fn validate_format(&self) -> Result<(), String> {
        unsafe {
            let image = &*self.image;
            if image.bits_per_pixel != 32 {
                return Err(format!("Unsupported window format: {} bits per pixel.", image.bits_per_pixel));
            }
            if image.byte_order != xlib::LSBFirst {
                return Err("Unsupported window format: MSB-first byte order.".to_string());
            }
            if image.red_mask != 0x00ff_0000 || image.green_mask != 0x0000_ff00 || image.blue_mask != 0x0000_00ff {
                return Err(format!(
                    "Unsupported window format: channel masks R={:#x} G={:#x} B={:#x}.",
                    image.red_mask, image.green_mask, image.blue_mask
                ));
            }
            Ok(())
        }
    }

    /// Grab the current window contents. The returned slice is shared memory the
    /// X server writes into, so it is only valid until the next call.
    pub fn capture(&mut self) -> Result<Frame<'_>, String> {
        let (width, height) = self.window_size()?;
        if width != self.width || height != self.height {
            self.rebuild(width, height)?;
        }

        // A composite-named pixmap goes stale whenever the compositor recreates
        // the window's backing store — which happens repeatedly while a window is
        // first mapped and fullscreened, exactly when NDI is being switched on.
        // Refresh it and try again before giving up, rather than making the caller
        // tear the whole capture down and reconnect for every such frame.
        if !self.grab() {
            self.rebuild(width, height)?;
            if !self.grab() {
                return Err("XShmGetImage failed twice for this frame.".to_string());
            }
        }

        unsafe {
            let image = &*self.image;
            let stride = image.bytes_per_line as usize;
            let data = std::slice::from_raw_parts(self.seg.shmaddr as *const u8, stride * height as usize);
            Ok(Frame { data, width, height, stride })
        }
    }

    /// One XShmGetImage attempt. The named pixmap is preferred when a compositor
    /// is involved; reading the window directly (the fallback) leaves obscured
    /// areas undefined.
    fn grab(&mut self) -> bool {
        unsafe {
            let drawable = if self.pixmap != 0 { self.pixmap } else { self.window };
            take_x_error();
            let ok = (self.xext.XShmGetImage)(self.display, drawable, self.image, 0, 0, u32::MAX);
            ok != 0 && take_x_error() == 0
        }
    }

    fn release_buffers(&mut self) {
        unsafe {
            if !self.image.is_null() {
                (self.xext.XShmDetach)(self.display, &mut self.seg);
                // XDestroyImage would free `data` with free(3); it is a shmat
                // address, so hand it a null pointer instead.
                (*self.image).data = ptr::null_mut();
                (self.xlib.XDestroyImage)(self.image);
                self.image = ptr::null_mut();
            }
            if !self.seg.shmaddr.is_null() {
                libc::shmdt(self.seg.shmaddr as *const c_void);
                self.seg.shmaddr = ptr::null_mut();
            }
            if self.pixmap != 0 {
                (self.xlib.XFreePixmap)(self.display, self.pixmap);
                self.pixmap = 0;
            }
        }
    }
}

impl Drop for X11WindowCapture {
    fn drop(&mut self) {
        self.release_buffers();
        unsafe {
            if self.we_redirected {
                if let Some(composite) = self.composite.as_ref() {
                    (composite.unredirect_window)(self.display, self.window, COMPOSITE_REDIRECT_AUTOMATIC);
                }
            }
            (self.xlib.XCloseDisplay)(self.display);
        }
    }
}

/// Depth-first walk of the window tree looking for a viewable window whose
/// title contains `needle`.
unsafe fn find_window(xlib: &Xlib, display: *mut Display, window: Window, needle: &str) -> Option<Window> {
    if window_title(xlib, display, window).is_some_and(|title| title.contains(needle)) {
        let mut attrs: xlib::XWindowAttributes = std::mem::zeroed();
        if (xlib.XGetWindowAttributes)(display, window, &mut attrs) != 0
            && attrs.map_state == xlib::IsViewable
        {
            return Some(window);
        }
    }

    let mut root = 0;
    let mut parent = 0;
    let mut children: *mut Window = ptr::null_mut();
    let mut count: c_uint = 0;
    if (xlib.XQueryTree)(display, window, &mut root, &mut parent, &mut children, &mut count) == 0 {
        return None;
    }

    let mut found = None;
    if !children.is_null() {
        let list = std::slice::from_raw_parts(children, count as usize);
        for &child in list {
            if let Some(hit) = find_window(xlib, display, child, needle) {
                found = Some(hit);
                break;
            }
        }
        (xlib.XFree)(children as *mut c_void);
    }
    found
}

/// _NET_WM_NAME (UTF-8, what GTK sets) with a fallback to legacy WM_NAME.
unsafe fn window_title(xlib: &Xlib, display: *mut Display, window: Window) -> Option<String> {
    let net_wm_name = CString::new("_NET_WM_NAME").ok()?;
    let utf8_string = CString::new("UTF8_STRING").ok()?;
    let name_atom = (xlib.XInternAtom)(display, net_wm_name.as_ptr(), 1);
    let utf8_atom = (xlib.XInternAtom)(display, utf8_string.as_ptr(), 1);

    if name_atom != 0 && utf8_atom != 0 {
        let mut actual_type = 0;
        let mut actual_format = 0;
        let mut nitems = 0;
        let mut bytes_after = 0;
        let mut prop: *mut u8 = ptr::null_mut();
        take_x_error();
        let status = (xlib.XGetWindowProperty)(
            display, window, name_atom, 0, 1024, 0, utf8_atom,
            &mut actual_type, &mut actual_format, &mut nitems, &mut bytes_after, &mut prop,
        );
        if status == 0 && !prop.is_null() {
            let bytes = std::slice::from_raw_parts(prop, nitems as usize);
            let title = String::from_utf8_lossy(bytes).into_owned();
            (xlib.XFree)(prop as *mut c_void);
            if !title.is_empty() {
                return Some(title);
            }
        }
        take_x_error();
    }

    let mut legacy: *mut c_char = ptr::null_mut();
    take_x_error();
    if (xlib.XFetchName)(display, window, &mut legacy) != 0 && !legacy.is_null() {
        let title = CStr::from_ptr(legacy).to_string_lossy().into_owned();
        (xlib.XFree)(legacy as *mut c_void);
        return Some(title);
    }
    take_x_error();
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const TITLE: &str = "Selah - Live Output (capture probe)";

    fn x_display_available() -> bool {
        let Ok(xlib) = Xlib::open() else { return false };
        unsafe {
            let dpy = (xlib.XOpenDisplay)(ptr::null());
            if dpy.is_null() {
                return false;
            }
            (xlib.XCloseDisplay)(dpy);
        }
        true
    }


    /// Creates a real X11 window, paints known colours into it, captures it
    /// through the same code path NDI uses, and checks the pixels came back.
    #[test]
    fn captures_the_pixels_of_a_real_window() {
        let xlib = Xlib::open().expect("libX11");
        unsafe {
            (xlib.XSetErrorHandler)(Some(x_error_handler));
            let dpy = (xlib.XOpenDisplay)(ptr::null());
            if dpy.is_null() {
                // Headless machine (or CI): nothing to capture, so there is
                // nothing this test can assert. Say so rather than fail.
                eprintln!("SKIPPED: no X display available — run under X11/XWayland to exercise capture");
                return;
            }

            let screen = (xlib.XDefaultScreen)(dpy);
            let root = (xlib.XRootWindow)(dpy, screen);
            let black = (xlib.XBlackPixel)(dpy, screen);

            let (w, h) = (240u32, 120u32);
            let win = (xlib.XCreateSimpleWindow)(dpy, root, 0, 0, w, h, 0, black, black);
            let title = CString::new(TITLE).unwrap();
            (xlib.XStoreName)(dpy, win, title.as_ptr());
            (xlib.XMapWindow)(dpy, win);
            (xlib.XSync)(dpy, 0);

            let gc = (xlib.XCreateGC)(dpy, win, 0, ptr::null_mut());
            let paint = || {
                // Two solid blocks: red on the left half, green on the right.
                (xlib.XSetForeground)(dpy, gc, 0x00ff_0000);
                (xlib.XFillRectangle)(dpy, win, gc, 0, 0, w / 2, h);
                (xlib.XSetForeground)(dpy, gc, 0x0000_ff00);
                (xlib.XFillRectangle)(dpy, win, gc, (w / 2) as i32, 0, w / 2, h);
                (xlib.XSync)(dpy, 0);
            };
            paint();

            // The window manager reparents and maps asynchronously, so a window
            // created this instant isn't viewable yet — the same reason the real
            // capture loop waits for the live output window instead of giving up.
            let mut capture = None;
            for _ in 0..40 {
                match X11WindowCapture::open(TITLE) {
                    Ok(open) => { capture = Some(open); break }
                    Err(_) => std::thread::sleep(std::time::Duration::from_millis(50)),
                }
            }
            let mut capture = capture.expect("capture opens within 2s");

            let mut frame_pixels = Vec::new();
            let (mut fw, mut fh, mut stride) = (0, 0, 0);
            for _ in 0..40 {
                // Repaint each round: without a compositor holding the window's
                // pixmap, mapping/exposing can clear it back to the background.
                paint();
                if let Ok(frame) = capture.capture() {
                    frame_pixels = frame.data.to_vec();
                    (fw, fh, stride) = (frame.width, frame.height, frame.stride);
                    let mid = stride * (fh as usize / 2);
                    if frame_pixels[mid + 8] != 0 || frame_pixels[mid + 9] != 0 || frame_pixels[mid + 10] != 0 {
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            assert_eq!((fw, fh), (w, h), "captured the window's own size");
            assert!(!frame_pixels.is_empty(), "got a frame");

            let px = |x: usize, y: usize| -> (u8, u8, u8) {
                let o = y * stride + x * 4;
                (frame_pixels[o], frame_pixels[o + 1], frame_pixels[o + 2]) // B, G, R
            };

            let left = px(20, (h / 2) as usize);
            let right = px((w - 20) as usize, (h / 2) as usize);
            println!("left BGR = {left:?}, right BGR = {right:?}");

            // Red block: R high, G/B low. Green block: G high, R/B low.
            assert!(left.2 > 200 && left.1 < 60 && left.0 < 60, "left half is red, got {left:?}");
            assert!(right.1 > 200 && right.2 < 60 && right.0 < 60, "right half is green, got {right:?}");

            drop(capture);
            (xlib.XFreeGC)(dpy, gc);
            (xlib.XDestroyWindow)(dpy, win);
            (xlib.XCloseDisplay)(dpy);
        }
    }

    /// The whole Linux path, through the real NDI runtime: paint a window, run
    /// the capture loop against a live sender, and check frames actually reach
    /// NDI. Skips when the runtime isn't installed (set NDI_RUNTIME_DIR_V6).
    #[test]
    fn pushes_captured_frames_into_the_real_runtime() {
        if !x_display_available() {
            eprintln!("SKIPPED: no X display available");
            return;
        }
        if super::super::ndi_lib::NdiLib::get().is_none() {
            eprintln!("SKIPPED: no NDI runtime — point NDI_RUNTIME_DIR_V6 at the SDK to run this");
            return;
        }

        let xlib = Xlib::open().expect("libX11");
        unsafe {
            (xlib.XSetErrorHandler)(Some(x_error_handler));
            let dpy = (xlib.XOpenDisplay)(ptr::null());
            let screen = (xlib.XDefaultScreen)(dpy);
            let root = (xlib.XRootWindow)(dpy, screen);
            let black = (xlib.XBlackPixel)(dpy, screen);

            let win = (xlib.XCreateSimpleWindow)(dpy, root, 0, 0, 320, 180, 0, black, black);
            // Must contain LIVE_WINDOW_TITLE for the loop to adopt it.
            let title = CString::new("Selah - Live Output (ndi probe)").unwrap();
            (xlib.XStoreName)(dpy, win, title.as_ptr());
            (xlib.XMapWindow)(dpy, win);
            let gc = (xlib.XCreateGC)(dpy, win, 0, ptr::null_mut());
            (xlib.XSetForeground)(dpy, gc, 0x0000_00ff);
            (xlib.XFillRectangle)(dpy, win, gc, 0, 0, 320, 180);
            (xlib.XSync)(dpy, 0);

            let sender = Arc::new(NdiSender::new());
            let config = NdiOutputConfig {
                source_name: "Selah Linux Capture Probe".to_string(),
                ..Default::default()
            };
            sender.start(&config).expect("sender starts");

            let stop = Arc::new(AtomicBool::new(true));
            start_capture(&config, sender.clone(), stop.clone()).expect("capture starts");

            // The loop waits up to 2s per attempt for the window to be viewable.
            let mut frames = 0;
            for _ in 0..60 {
                (xlib.XSetForeground)(dpy, gc, 0x0000_00ff);
                (xlib.XFillRectangle)(dpy, win, gc, 0, 0, 320, 180);
                (xlib.XSync)(dpy, 0);
                std::thread::sleep(Duration::from_millis(100));
                frames = sender.frames_sent();
                if frames > 3 {
                    break;
                }
            }
            stop.store(false, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(100));
            sender.stop();

            (xlib.XFreeGC)(dpy, gc);
            (xlib.XDestroyWindow)(dpy, win);
            (xlib.XCloseDisplay)(dpy);

            assert!(frames > 3, "expected frames to reach NDI, got {frames}");
        }
    }

    #[test]
    fn reports_a_missing_window_clearly() {
        if !x_display_available() {
            eprintln!("SKIPPED: no X display available");
            return;
        }
        let err = match X11WindowCapture::open("no such window exists anywhere") {
            Ok(_) => panic!("unexpectedly found a window"),
            Err(err) => err,
        };
        assert!(err.contains("No X11 window titled"), "got: {err}");
    }
}
