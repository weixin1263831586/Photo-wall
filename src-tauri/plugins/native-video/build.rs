const COMMANDS: &[&str] = &[
    "capabilities",
    "transcode",
    "open_file",
    "extract_poster",
    "transcode_frames",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
