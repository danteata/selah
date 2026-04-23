fn main() {
    #[cfg(all(target_os = "macos", feature = "ndi"))]
    {
        let ndi_lib = "/Library/NDI SDK for Apple/lib/macOS";
        println!("cargo:rustc-link-arg=-Wl,-rpath,{ndi_lib}");
    }

    tauri_build::build()
}
