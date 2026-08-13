use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_video);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NativeVideo<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.photowall.nativevideo", "ExamplePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_native_video)?;
    Ok(NativeVideo(handle))
}

/// Access to the native-video APIs.
pub struct NativeVideo<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeVideo<R> {
    pub fn capabilities(&self) -> crate::Result<NativeVideoCapabilities> {
        self.0
            .run_mobile_plugin("capabilities", ())
            .map_err(Into::into)
    }

    pub fn transcode(&self, payload: TranscodeRequest) -> crate::Result<TranscodeResponse> {
        self.0
            .run_mobile_plugin("transcode", payload)
            .map_err(Into::into)
    }
}
