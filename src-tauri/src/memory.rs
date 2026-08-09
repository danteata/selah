//! glibc allocator tuning (Linux only).
//!
//! A service runs the capture pipeline continuously for an hour or more, and
//! every VAD segment allocates multi-megabyte transient buffers that are freed
//! within seconds: the segment's 16 kHz PCM (~32 KB per second, held twice —
//! once for the transcription job, once for the session WAV) plus the engine's
//! per-run mel/FFT scratch.
//!
//! glibc's malloc serves allocations above its "mmap threshold" with a private
//! mmap that is returned to the OS on free. But the threshold is *dynamic*:
//! freeing an mmapped block raises it to that block's size (up to 32 MB), so
//! after the first segment every later large buffer is served from malloc
//! arenas instead. Arena memory freed by the app is cached for reuse, and
//! interleaved small live allocations pin those pages, so the OS never gets
//! them back. RSS grows by roughly the transient-buffer volume of the whole
//! session, is never touched again, and slowly migrates to swap.
//!
//! Handy measured this at ~15 MB retained per 2-minute dictation, dropping to
//! ~0.5 MB once the threshold was pinned (their issue #1792). Selah's exposure
//! is larger: dictation is seconds at a time, a service is ninety minutes of
//! back-to-back segments.
//!
//! Both entry points are no-ops on non-glibc targets (Windows, macOS, musl):
//! this failure mode is specific to glibc's dynamic-threshold heuristic.

/// Pin glibc's mmap threshold so large transient buffers keep taking the mmap
/// path and are returned to the OS as soon as they are freed.
///
/// Must run before the workload allocates — called at the top of `run()`. The
/// cost is an mmap/munmap round-trip per multi-MB buffer, which is negligible
/// against the transcription that follows it.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub fn init_allocator() {
    // SAFETY: FFI call with no memory arguments; mallopt only updates malloc's
    // internal parameters.
    unsafe {
        libc::mallopt(libc::M_MMAP_THRESHOLD, 128 * 1024);
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub fn init_allocator() {}
