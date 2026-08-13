use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NativeVideoExt;
use crate::Result;

#[command]
pub(crate) async fn capabilities<R: Runtime>(app: AppHandle<R>) -> Result<NativeVideoCapabilities> {
    app.native_video().capabilities()
}

#[command]
pub(crate) async fn transcode<R: Runtime>(
    app: AppHandle<R>,
    payload: TranscodeRequest,
) -> Result<TranscodeResponse> {
    tauri::async_runtime::spawn_blocking(move || app.native_video().transcode(payload))
        .await
        .map_err(|error| crate::Error::Message(error.to_string()))?
}
