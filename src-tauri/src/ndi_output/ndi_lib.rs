//! Runtime bindings to the NDI library, loaded with `libloading`.
//!
//! Why not a bindings crate
//! -----------------------
//! `grafton-ndi` (what this replaces) emits `cargo:rustc-link-lib=dylib=ndi`, so
//! the NDI library is resolved by the loader at process start. On Windows that
//! puts a hard import on `Processing.NDI.Lib.x64.dll`; if it isn't installed the
//! process dies before `main`. For an app that runs a Sunday service, shipping a
//! binary that won't launch unless the operator happens to have NDI Tools is not
//! an option — which is why NDI was behind an off-by-default Cargo feature and
//! therefore absent from every release.
//!
//! It also needed the NDI SDK present at build time (`NDI_SDK_DIR`), so enabling
//! it meant installing the SDK on every CI runner.
//!
//! Loading at runtime solves both. The library is opened on first use; if it
//! isn't there, NDI reports itself unavailable and the rest of Selah is
//! unaffected. Nothing is needed at build time, so releases can carry NDI
//! support unconditionally.
//!
//! This is the approach the SDK documents (§4): the headers may be redistributed
//! and "used with dynamic loading of the NDI libraries", and the SDK exposes
//! `NDILIB_REDIST_FOLDER` — the environment variable pointing at an installed
//! runtime — precisely so an application can find it this way.
//!
//! ABI
//! ---
//! The structs and enum values below are transcribed from the NDI 6 SDK headers
//! (`Processing.NDI.structs.h`, `.Send.h`, `.Find.h`). They are a C ABI contract:
//! field order and types must match the headers exactly, so don't reorder them.
//! Every symbol used here is exported individually by the library (verified with
//! `nm -D` against `libndi.so.6`), so none of this depends on the layout of the
//! `NDIlib_v6_load` function table.

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_int, c_void, CString};
use std::sync::OnceLock;

/// `NDI_LIB_FOURCC(ch0, ch1, ch2, ch3)` from the headers.
const fn fourcc(a: u8, b: u8, c: u8, d: u8) -> u32 {
    (a as u32) | ((b as u32) << 8) | ((c as u32) << 16) | ((d as u32) << 24)
}

/// `NDIlib_FourCC_video_type_BGRA`.
pub const FOURCC_BGRA: u32 = fourcc(b'B', b'G', b'R', b'A');
/// `NDIlib_FourCC_video_type_BGRX` — same layout as BGRA with the fourth byte
/// ignored. Needed for X11 depth-24 windows, whose padding byte is zero: sent as
/// BGRA a receiver reads that as fully transparent and shows black.
pub const FOURCC_BGRX: u32 = fourcc(b'B', b'G', b'R', b'X');
/// `NDIlib_FourCC_video_type_RGBA`. Canvas pixels are RGBA with straight
/// (unpremultiplied) alpha, which is exactly what NDI wants — so a frame drawn in
/// the app goes out without any channel swizzling.
pub const FOURCC_RGBA: u32 = fourcc(b'R', b'G', b'B', b'A');
/// `NDIlib_FourCC_audio_type_FLTp` — planar 32-bit float.
pub const FOURCC_FLTP: u32 = fourcc(b'F', b'L', b'T', b'p');
/// `NDIlib_frame_format_type_progressive`.
pub const FRAME_FORMAT_PROGRESSIVE: c_int = 1;

pub type SendInstance = *mut c_void;
pub type FindInstance = *mut c_void;

#[repr(C)]
pub struct SendCreate {
    pub p_ndi_name: *const c_char,
    pub p_groups: *const c_char,
    pub clock_video: bool,
    pub clock_audio: bool,
}

#[repr(C)]
pub struct VideoFrameV2 {
    pub xres: c_int,
    pub yres: c_int,
    pub four_cc: u32,
    pub frame_rate_n: c_int,
    pub frame_rate_d: c_int,
    pub picture_aspect_ratio: f32,
    pub frame_format_type: c_int,
    pub timecode: i64,
    pub p_data: *mut u8,
    /// Union in C: `line_stride_in_bytes` for uncompressed formats.
    pub line_stride_in_bytes: c_int,
    pub p_metadata: *const c_char,
    pub timestamp: i64,
}

#[repr(C)]
pub struct AudioFrameV3 {
    pub sample_rate: c_int,
    pub no_channels: c_int,
    pub no_samples: c_int,
    pub timecode: i64,
    pub four_cc: u32,
    pub p_data: *mut u8,
    /// Union in C: `channel_stride_in_bytes` for planar formats.
    pub channel_stride_in_bytes: c_int,
    pub p_metadata: *const c_char,
    pub timestamp: i64,
}

#[repr(C)]
pub struct FindCreate {
    pub show_local_sources: bool,
    pub p_groups: *const c_char,
    pub p_extra_ips: *const c_char,
}

#[repr(C)]
pub struct Source {
    pub p_ndi_name: *const c_char,
    /// Union in C: `p_url_address`.
    pub p_url_address: *const c_char,
}

type FnInitialize = unsafe extern "C" fn() -> bool;
type FnDestroy = unsafe extern "C" fn();
type FnSendCreate = unsafe extern "C" fn(*const SendCreate) -> SendInstance;
type FnSendDestroy = unsafe extern "C" fn(SendInstance);
type FnSendVideoV2 = unsafe extern "C" fn(SendInstance, *const VideoFrameV2);
type FnSendAudioV3 = unsafe extern "C" fn(SendInstance, *const AudioFrameV3);
type FnFindCreateV2 = unsafe extern "C" fn(*const FindCreate) -> FindInstance;
type FnFindDestroy = unsafe extern "C" fn(FindInstance);
type FnFindWaitForSources = unsafe extern "C" fn(FindInstance, u32) -> bool;
type FnFindGetCurrentSources = unsafe extern "C" fn(FindInstance, *mut u32) -> *const Source;

/// The loaded library and the entry points Selah uses.
///
/// `_library` is held to keep the module mapped — dropping it would invalidate
/// every function pointer below.
pub struct NdiLib {
    _library: Library,
    initialize: FnInitialize,
    destroy: FnDestroy,
    send_create: FnSendCreate,
    send_destroy: FnSendDestroy,
    send_video: FnSendVideoV2,
    send_audio: FnSendAudioV3,
    find_create: FnFindCreateV2,
    find_destroy: FnFindDestroy,
    find_wait_for_sources: FnFindWaitForSources,
    find_get_current_sources: FnFindGetCurrentSources,
}

// The NDI library is documented as thread-safe for these calls, and the
// pointers are immutable once loaded.
unsafe impl Send for NdiLib {}
unsafe impl Sync for NdiLib {}

/// Library file name for the platform, matching `NDILIB_LIBRARY_NAME`.
#[cfg(target_os = "windows")]
const LIBRARY_NAME: &str = "Processing.NDI.Lib.x64.dll";
#[cfg(target_os = "macos")]
const LIBRARY_NAME: &str = "libndi.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const LIBRARY_NAME: &str = "libndi.so.6";

/// Environment variables the SDK sets to point at an installed runtime
/// (`NDILIB_REDIST_FOLDER`). Newest first, so a v6 install wins over a v5 one.
const REDIST_ENV_VARS: &[&str] = &[
    "NDI_RUNTIME_DIR_V6",
    "NDI_RUNTIME_DIR_V5",
    "NDI_RUNTIME_DIR_V4",
];

/// Fallback install locations, for when the environment variable is missing —
/// it is set by the installer, so it's absent in a shell that predates the
/// install, and on macOS for GUI apps launched from Finder.
#[cfg(target_os = "windows")]
const FALLBACK_DIRS: &[&str] = &[
    "C:\\Program Files\\NDI\\NDI 6 Runtime\\v6",
    "C:\\Program Files\\NDI\\NDI 5 Runtime\\v5",
    "C:\\Program Files\\NDI\\NDI 6 SDK\\Bin\\x64",
];
#[cfg(target_os = "macos")]
const FALLBACK_DIRS: &[&str] = &[
    "/usr/local/lib",
    "/Library/NDI SDK for Apple/lib/macOS",
    "/Library/Application Support/NewTek/NDI",
];
#[cfg(all(unix, not(target_os = "macos")))]
const FALLBACK_DIRS: &[&str] = &["/usr/local/lib", "/usr/lib", "/usr/lib/x86_64-linux-gnu"];

/// Does this file name look like the NDI library for this platform?
///
/// Deliberately loose on Unix: the SDK ships `libndi.so.6.3.2` and leaves the
/// unversioned `libndi.so.6` symlink to the installer's ldconfig step, so an
/// extracted-but-not-registered SDK is a real and perfectly usable install that
/// an exact-name match would walk straight past.
fn matches_library_name(name: &str) -> bool {
    #[cfg(target_os = "windows")]
    return name.eq_ignore_ascii_case(LIBRARY_NAME);
    #[cfg(target_os = "macos")]
    return name.starts_with("libndi") && name.contains(".dylib");
    #[cfg(all(unix, not(target_os = "macos")))]
    return name.starts_with("libndi.so");
}

/// Every library file in `dir`, canonical name first then versioned ones,
/// highest version first (string order puts `libndi.so.6.3.2` above `.5.x`).
fn library_files_in(dir: &str) -> Vec<String> {
    let dir = dir.trim_end_matches(['/', '\\']);
    let mut paths = vec![format!("{dir}/{LIBRARY_NAME}")];

    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut versioned: Vec<String> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name != LIBRARY_NAME && matches_library_name(name))
            .collect();
        versioned.sort_by(|a, b| b.cmp(a));
        paths.extend(versioned.into_iter().map(|name| format!("{dir}/{name}")));
    }

    paths
}

/// Directories inside the installed app where a bundled runtime may sit.
///
/// Shipping the runtime is what makes NDI work without installing NDI Tools. The
/// layout differs per bundle format, so several relatives of the executable are
/// tried: `Resources` for a macOS .app, `resources` for the Linux and Windows
/// bundles Tauri produces, and the executable's own directory for a plain build.
/// Per-platform folder name under `ndi-runtime/`, matching the bundle configs.
#[cfg(target_os = "windows")]
const PLATFORM_DIR: &str = "windows";
#[cfg(target_os = "macos")]
const PLATFORM_DIR: &str = "macos";
#[cfg(all(unix, not(target_os = "macos")))]
const PLATFORM_DIR: &str = "linux";

fn bundled_runtime_dirs() -> Vec<std::path::PathBuf> {
    let Ok(exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let Some(dir) = exe.parent() else {
        return Vec::new();
    };

    // Two bundle layouts to satisfy: a flat map (`"ndi-runtime/windows/":
    // "ndi-runtime/"`) puts the library in `resources/ndi-runtime`, while a
    // path-preserving glob (`ndi-runtime/linux/**/*`) keeps the platform folder.
    let mut dirs = vec![
        dir.join("ndi-runtime"),
        dir.join("resources").join("ndi-runtime"),
        dir.join("resources").join("ndi-runtime").join(PLATFORM_DIR),
        dir.to_path_buf(),
    ];

    // macOS: Contents/MacOS/selah → Contents/Resources.
    if let Some(contents) = dir.parent() {
        dirs.push(contents.join("Resources").join("ndi-runtime"));
        dirs.push(contents.join("Resources").join("ndi-runtime").join(PLATFORM_DIR));
        dirs.push(contents.join("Resources"));
        // Linux deb/rpm/AppImage: the binary is usr/bin/selah while resources go
        // to usr/lib/selah/resources, so neither is a sibling of the executable.
        for base in [contents.join("lib").join("selah").join("resources"), contents.join("lib")] {
            dirs.push(base.join("ndi-runtime").join(PLATFORM_DIR));
            dirs.push(base.join("ndi-runtime"));
        }
    }

    dirs
}

/// Candidate paths in the order they should be tried.
///
/// A runtime shipped inside the app comes first: it is the version this build was
/// tested against, and preferring it means an old NDI Tools install on the machine
/// cannot shadow it. The platform's own search path is next, so an operator who
/// deliberately points at their own runtime still wins over the guessed locations.
pub fn candidate_paths() -> Vec<String> {
    let mut paths = Vec::new();

    for dir in bundled_runtime_dirs() {
        if let Some(dir) = dir.to_str() {
            paths.extend(library_files_in(dir));
        }
    }

    paths.push(LIBRARY_NAME.to_string());

    for var in REDIST_ENV_VARS {
        if let Ok(dir) = std::env::var(var) {
            if !dir.is_empty() {
                paths.extend(library_files_in(&dir));
            }
        }
    }

    for dir in FALLBACK_DIRS {
        paths.extend(library_files_in(dir));
    }

    paths
}

static INSTANCE: OnceLock<Option<NdiLib>> = OnceLock::new();

impl NdiLib {
    /// The loaded library, or None when the NDI runtime isn't installed.
    ///
    /// Loaded once per process: a failed load is cached too, so a missing
    /// runtime doesn't mean a filesystem probe on every frame.
    pub fn get() -> Option<&'static NdiLib> {
        INSTANCE.get_or_init(Self::load).as_ref()
    }

    fn load() -> Option<NdiLib> {
        for path in candidate_paths() {
            match unsafe { Library::new(&path) } {
                Ok(library) => match unsafe { Self::bind(library) } {
                    Ok(lib) => {
                        // Refuses to run on CPUs without the SIMD NDI needs.
                        if !unsafe { (lib.initialize)() } {
                            eprintln!("[ndi] runtime at {path} declined to initialize (unsupported CPU?)");
                            continue;
                        }
                        eprintln!("[ndi] loaded runtime from {path}");
                        return Some(lib);
                    }
                    Err(missing) => {
                        eprintln!("[ndi] {path} loaded but is missing {missing}");
                    }
                },
                Err(_) => { /* Not at this path — try the next. */ }
            }
        }
        eprintln!("[ndi] no NDI runtime found; NDI output unavailable");
        None
    }

    /// Resolve every entry point, naming the first one that's missing.
    unsafe fn bind(library: Library) -> Result<NdiLib, &'static str> {
        macro_rules! sym {
            ($name:literal, $t:ty) => {{
                let s: Symbol<$t> = library.get(concat!($name, "\0").as_bytes()).map_err(|_| $name)?;
                *s
            }};
        }

        Ok(NdiLib {
            initialize: sym!("NDIlib_initialize", FnInitialize),
            destroy: sym!("NDIlib_destroy", FnDestroy),
            send_create: sym!("NDIlib_send_create", FnSendCreate),
            send_destroy: sym!("NDIlib_send_destroy", FnSendDestroy),
            send_video: sym!("NDIlib_send_send_video_v2", FnSendVideoV2),
            send_audio: sym!("NDIlib_send_send_audio_v3", FnSendAudioV3),
            find_create: sym!("NDIlib_find_create_v2", FnFindCreateV2),
            find_destroy: sym!("NDIlib_find_destroy", FnFindDestroy),
            find_wait_for_sources: sym!("NDIlib_find_wait_for_sources", FnFindWaitForSources),
            find_get_current_sources: sym!("NDIlib_find_get_current_sources", FnFindGetCurrentSources),
            _library: library,
        })
    }

    /// Create a sender. `groups` of None means the default group.
    pub fn send_create(&self, name: &str, groups: Option<&str>, clock_audio: bool) -> Option<SenderHandle> {
        let name = CString::new(name).ok()?;
        let groups = groups.map(|g| CString::new(g).ok()).flatten();

        let settings = SendCreate {
            p_ndi_name: name.as_ptr(),
            p_groups: groups.as_ref().map_or(std::ptr::null(), |g| g.as_ptr()),
            clock_video: true,
            clock_audio,
        };

        let instance = unsafe { (self.send_create)(&settings) };
        if instance.is_null() {
            return None;
        }
        Some(SenderHandle { instance })
    }

    pub fn send_video(&self, sender: &SenderHandle, frame: &VideoFrameV2) {
        unsafe { (self.send_video)(sender.instance, frame) }
    }

    pub fn send_audio(&self, sender: &SenderHandle, frame: &AudioFrameV3) {
        unsafe { (self.send_audio)(sender.instance, frame) }
    }

    pub fn send_destroy(&self, sender: &SenderHandle) {
        unsafe { (self.send_destroy)(sender.instance) }
    }

    /// Sources visible on the network, waiting up to `timeout_ms` for the first.
    pub fn find_sources(&self, timeout_ms: u32) -> Vec<(String, String)> {
        let settings = FindCreate {
            show_local_sources: true,
            p_groups: std::ptr::null(),
            p_extra_ips: std::ptr::null(),
        };

        let finder = unsafe { (self.find_create)(&settings) };
        if finder.is_null() {
            return Vec::new();
        }

        unsafe { (self.find_wait_for_sources)(finder, timeout_ms) };

        let mut count: u32 = 0;
        let sources = unsafe { (self.find_get_current_sources)(finder, &mut count) };

        let mut out = Vec::new();
        if !sources.is_null() {
            for i in 0..count as isize {
                let source = unsafe { &*sources.offset(i) };
                out.push((
                    cstr_to_string(source.p_ndi_name),
                    cstr_to_string(source.p_url_address),
                ));
            }
        }

        // The source array belongs to the finder, so it must be read before this.
        unsafe { (self.find_destroy)(finder) };
        out
    }

    /// Release the library's global state. Only for process shutdown.
    #[allow(dead_code)]
    pub fn shutdown(&self) {
        unsafe { (self.destroy)() }
    }
}

fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

/// An NDI sender, destroyed with the library that created it.
pub struct SenderHandle {
    instance: SendInstance,
}

// Guarded by the RwLock in NdiSender; the NDI send calls take a const instance.
unsafe impl Send for SenderHandle {}
unsafe impl Sync for SenderHandle {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fourcc_packs_little_endian() {
        // 'BGRA' -> 0x41524742. Getting this wrong would send channel-swapped
        // video, which is why it's pinned by a test rather than eyeballed.
        assert_eq!(FOURCC_BGRA, 0x4152_4742);
        assert_eq!(FOURCC_BGRX, 0x5852_4742);
        assert_eq!(FOURCC_RGBA, 0x4142_4752);
        assert_eq!(FOURCC_FLTP, 0x7054_4C46);
    }

    #[test]
    fn library_search_prefers_the_runtime_shipped_with_the_app() {
        let paths = candidate_paths();

        // The order changed when the runtime started shipping inside the app: the
        // bundled copy is the one this build was tested against, and trying it
        // first means an older NDI Tools install on the machine can't shadow it.
        let bare = paths.iter().position(|p| p == LIBRARY_NAME).expect("bare name is still a candidate");
        let bundled = paths
            .iter()
            .position(|p| p.contains("ndi-runtime"))
            .expect("a bundled location is searched");
        assert!(bundled < bare, "the app's own runtime must be tried before the system one");

        // The bare name has to remain, so the platform's loader path (PATH,
        // LD_LIBRARY_PATH, DYLD_LIBRARY_PATH, rpath) still works for anyone
        // deliberately pointing at their own build.
        assert!(bare < paths.len());
        assert!(paths.len() > 2, "fallback directories should be included too");
    }

    /// Exercises the real library when one is installed: loads it, creates a
    /// sender, pushes a frame through and tears it down. This is what proves the
    /// symbol names and struct layouts are right — the offset assertions above
    /// only prove they match what the headers said.
    ///
    /// Skipped (with a note) when no runtime is present, so CI doesn't need one.
    /// Point NDI_RUNTIME_DIR_V6 at an SDK lib directory to run it locally.
    #[test]
    fn sends_a_frame_through_the_real_runtime() {
        let Some(lib) = NdiLib::get() else {
            eprintln!("skipped: no NDI runtime on this machine");
            return;
        };

        let sender = lib
            .send_create("Selah Shim Test", Some("Public"), false)
            .expect("NDI accepted the sender settings");

        let width = 64usize;
        let height = 32usize;
        let stride = width * 4;
        let mut pixels = vec![0u8; stride * height];
        // Distinguishable BGRA so a channel-order mistake would be visible to a
        // receiver rather than silently plausible.
        for px in pixels.chunks_exact_mut(4) {
            px.copy_from_slice(&[0x10, 0x20, 0x30, 0xFF]);
        }

        let frame = VideoFrameV2 {
            xres: width as i32,
            yres: height as i32,
            four_cc: FOURCC_BGRA,
            frame_rate_n: 30,
            frame_rate_d: 1,
            picture_aspect_ratio: 0.0,
            frame_format_type: FRAME_FORMAT_PROGRESSIVE,
            timecode: 0,
            p_data: pixels.as_mut_ptr(),
            line_stride_in_bytes: stride as i32,
            p_metadata: std::ptr::null(),
            timestamp: 0,
        };
        lib.send_video(&sender, &frame);

        let mut samples = vec![0.0f32; 480 * 2];
        let audio = AudioFrameV3 {
            sample_rate: 48_000,
            no_channels: 2,
            no_samples: 480,
            timecode: 0,
            four_cc: FOURCC_FLTP,
            p_data: samples.as_mut_ptr() as *mut u8,
            channel_stride_in_bytes: 480 * 4,
            p_metadata: std::ptr::null(),
            timestamp: 0,
        };
        lib.send_audio(&sender, &audio);

        // Discovery should at least see the source we just created.
        let sources = lib.find_sources(1_500);
        eprintln!("NDI sources visible: {sources:?}");

        lib.send_destroy(&sender);
    }

    #[test]
    fn library_search_finds_a_versioned_file() {
        // The SDK tarball contains only libndi.so.6.3.2 — no unversioned
        // symlink — so an exact-name search finds nothing in a perfectly good
        // install. This is how that was discovered, so it stays a test.
        let dir = std::env::temp_dir().join("selah-ndi-versioned-test");
        let _ = std::fs::create_dir_all(&dir);
        let versioned = dir.join(if cfg!(target_os = "windows") {
            "Processing.NDI.Lib.x64.dll"
        } else if cfg!(target_os = "macos") {
            "libndi.6.dylib"
        } else {
            "libndi.so.6.3.2"
        });
        std::fs::write(&versioned, b"not a real library").unwrap();

        let found = library_files_in(dir.to_str().unwrap());
        let _ = std::fs::remove_file(&versioned);

        assert!(
            found.iter().any(|p| p == versioned.to_str().unwrap()),
            "versioned library should be a candidate: {found:?}"
        );
    }

    #[test]
    fn library_search_honours_the_sdk_env_var() {
        // Set by the NDI installer; the SDK documents it as NDILIB_REDIST_FOLDER.
        // Restore whatever was there rather than clearing it: env vars are
        // process-wide, and clearing this one hid a real runtime from the
        // integration test below.
        let previous = std::env::var("NDI_RUNTIME_DIR_V6").ok();
        std::env::set_var("NDI_RUNTIME_DIR_V6", "/opt/ndi/lib/");
        let paths = candidate_paths();
        match previous {
            Some(value) => std::env::set_var("NDI_RUNTIME_DIR_V6", value),
            None => std::env::remove_var("NDI_RUNTIME_DIR_V6"),
        }

        assert!(
            paths.iter().any(|p| p == &format!("/opt/ndi/lib/{LIBRARY_NAME}")),
            "env var directory should be searched, with the trailing slash trimmed: {paths:?}"
        );
    }

    /// Sizes and offsets taken from the NDI 6 SDK headers by compiling a C probe
    /// against them (`sizeof`/`offsetof` on x86_64), not by hand-adding field
    /// widths — padding makes that arithmetic wrong, and a wrong offset here
    /// means the library reads frame fields from the wrong bytes.
    ///
    /// Reordering any field in these structs will fail this test. That is the
    /// point: the order is a C ABI contract, not a style choice.
    #[test]
    fn struct_layouts_match_the_c_abi() {
        use std::mem::{offset_of, size_of};

        assert_eq!(size_of::<VideoFrameV2>(), 72, "video frame size");
        assert_eq!(offset_of!(VideoFrameV2, xres), 0);
        assert_eq!(offset_of!(VideoFrameV2, four_cc), 8);
        assert_eq!(offset_of!(VideoFrameV2, timecode), 32);
        assert_eq!(offset_of!(VideoFrameV2, p_data), 40);
        assert_eq!(offset_of!(VideoFrameV2, line_stride_in_bytes), 48);
        assert_eq!(offset_of!(VideoFrameV2, p_metadata), 56);
        assert_eq!(offset_of!(VideoFrameV2, timestamp), 64);

        assert_eq!(size_of::<AudioFrameV3>(), 64, "audio frame size");
        assert_eq!(offset_of!(AudioFrameV3, sample_rate), 0);
        assert_eq!(offset_of!(AudioFrameV3, no_channels), 4);
        assert_eq!(offset_of!(AudioFrameV3, no_samples), 8);
        assert_eq!(offset_of!(AudioFrameV3, timecode), 16);
        assert_eq!(offset_of!(AudioFrameV3, four_cc), 24);
        assert_eq!(offset_of!(AudioFrameV3, p_data), 32);
        assert_eq!(offset_of!(AudioFrameV3, channel_stride_in_bytes), 40);
        assert_eq!(offset_of!(AudioFrameV3, p_metadata), 48);
        assert_eq!(offset_of!(AudioFrameV3, timestamp), 56);

        assert_eq!(size_of::<SendCreate>(), 24, "send create size");
        assert_eq!(offset_of!(SendCreate, p_groups), 8);
        assert_eq!(offset_of!(SendCreate, clock_video), 16);
        assert_eq!(offset_of!(SendCreate, clock_audio), 17);

        assert_eq!(size_of::<Source>(), 16, "source size");
        assert_eq!(offset_of!(Source, p_url_address), 8);

        assert_eq!(size_of::<FindCreate>(), 24, "find create size");
        assert_eq!(offset_of!(FindCreate, p_groups), 8);
        assert_eq!(offset_of!(FindCreate, p_extra_ips), 16);
    }
}
