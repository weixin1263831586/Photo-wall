use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeRequest {
    pub input_path: String,
    pub output_path: String,
    pub audio_path: Option<String>,
    pub duration: f64,
    pub volume: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub loop_audio: bool,
    pub fade_in: f64,
    pub fade_out: f64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeResponse {
    pub output_path: String,
    pub encoder: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVideoCapabilities {
    pub available: bool,
    pub platform: String,
    pub encoder: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractPosterRequest {
    pub input_path: String,
    pub output_path: String,
    pub max_dimension: i32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractPosterResponse {
    pub output_path: String,
    pub width: i32,
    pub height: i32,
    pub duration: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeFramesRequest {
    pub frame_paths: Vec<String>,
    pub output_path: String,
    pub fps: i32,
    pub audio_path: Option<String>,
    pub duration: f64,
    pub volume: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub loop_audio: bool,
    pub fade_in: f64,
    pub fade_out: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileRequest {
    pub path: String,
    pub mime_type: String,
}
