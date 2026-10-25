// Desktop entry for `tauri dev` while working on the phone build; phones start
// from `run` through the mobile entry point.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    selah_mobile_lib::run()
}
