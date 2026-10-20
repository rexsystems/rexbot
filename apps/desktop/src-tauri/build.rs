fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["connect_website", "saved_website"]),
    ))
    .expect("could not build desktop permissions")
}
