#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
/// Start the Quickload desktop application using the native bridge configuration.
fn main() {
    quickload_app::run();
}
