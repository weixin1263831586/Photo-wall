use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::NativeVideo;
#[cfg(mobile)]
use mobile::NativeVideo;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the native-video APIs.
pub trait NativeVideoExt<R: Runtime> {
    fn native_video(&self) -> &NativeVideo<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NativeVideoExt<R> for T {
    fn native_video(&self) -> &NativeVideo<R> {
        self.state::<NativeVideo<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-video")
        .invoke_handler(tauri::generate_handler![
            commands::capabilities,
            commands::transcode
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let native_video = mobile::init(app, api)?;
            #[cfg(desktop)]
            let native_video = desktop::init(app, api)?;
            app.manage(native_video);
            Ok(())
        })
        .build()
}
