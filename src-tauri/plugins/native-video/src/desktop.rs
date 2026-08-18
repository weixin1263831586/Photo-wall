use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NativeVideo<R>> {
    Ok(NativeVideo(app.clone()))
}

/// Access to the native-video APIs.
pub struct NativeVideo<R: Runtime>(AppHandle<R>);

impl<R: Runtime> NativeVideo<R> {
    pub fn capabilities(&self) -> crate::Result<NativeVideoCapabilities> {
        Ok(NativeVideoCapabilities {
            available: cfg!(windows),
            platform: if cfg!(windows) {
                "windows"
            } else {
                std::env::consts::OS
            }
            .into(),
            encoder: if cfg!(windows) {
                "Windows MediaComposition (Media Foundation)"
            } else {
                "unavailable"
            }
            .into(),
        })
    }

    pub fn transcode(&self, payload: TranscodeRequest) -> crate::Result<TranscodeResponse> {
        #[cfg(windows)]
        return transcode_windows(payload);
        #[cfg(not(windows))]
        {
            let _ = payload;
            Err(crate::Error::Message(
                "Native video encoding is only available on Windows, Android and iOS".into(),
            ))
        }
    }

    /// Desktop keeps using the opener plugin path; the dedicated
    /// FileProvider-based open is a mobile-only concern.
    pub fn open_file(&self, payload: OpenFileRequest) -> crate::Result<()> {
        let _ = payload;
        Err(crate::Error::Message(
            "open_file is only available on Android and iOS".into(),
        ))
    }
}

#[cfg(windows)]
fn transcode_windows(payload: TranscodeRequest) -> crate::Result<TranscodeResponse> {
    use std::path::Path;
    use windows::{
        core::HSTRING,
        Foundation::TimeSpan,
        Media::{
            Editing::{BackgroundAudioTrack, MediaClip, MediaComposition, MediaTrimmingPreference},
            MediaProperties::{MediaEncodingProfile, VideoEncodingQuality},
            Transcoding::TranscodeFailureReason,
        },
        Storage::StorageFile,
    };

    if !Path::new(&payload.input_path).is_file() {
        return Err(crate::Error::Message(
            "Native encoder input file is missing".into(),
        ));
    }
    if let Some(parent) = Path::new(&payload.output_path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::File::create(&payload.output_path)?;

    let input = StorageFile::GetFileFromPathAsync(&HSTRING::from(&payload.input_path))
        .map_err(|error| crate::Error::Message(error.to_string()))?
        .get()
        .map_err(|error| crate::Error::Message(error.to_string()))?;
    let clip = MediaClip::CreateFromFileAsync(&input)
        .map_err(|error| crate::Error::Message(error.to_string()))?
        .get()
        .map_err(|error| crate::Error::Message(error.to_string()))?;
    let composition =
        MediaComposition::new().map_err(|error| crate::Error::Message(error.to_string()))?;
    composition
        .Clips()
        .map_err(|error| crate::Error::Message(error.to_string()))?
        .Append(&clip)
        .map_err(|error| crate::Error::Message(error.to_string()))?;

    if let Some(audio_path) = payload
        .audio_path
        .as_ref()
        .filter(|path| Path::new(path).is_file())
    {
        let audio_file = StorageFile::GetFileFromPathAsync(&HSTRING::from(audio_path))
            .map_err(|error| crate::Error::Message(error.to_string()))?
            .get()
            .map_err(|error| crate::Error::Message(error.to_string()))?;
        let track = BackgroundAudioTrack::CreateFromFileAsync(&audio_file)
            .map_err(|error| crate::Error::Message(error.to_string()))?
            .get()
            .map_err(|error| crate::Error::Message(error.to_string()))?;
        track
            .SetVolume(payload.volume.clamp(0.0, 1.0))
            .map_err(|error| crate::Error::Message(error.to_string()))?;
        track
            .SetTrimTimeFromStart(TimeSpan {
                Duration: (payload.start_time.max(0.0) * 10_000_000.0) as i64,
            })
            .map_err(|error| crate::Error::Message(error.to_string()))?;
        if payload.end_time > payload.start_time {
            let original = track
                .OriginalDuration()
                .map_err(|error| crate::Error::Message(error.to_string()))?
                .Duration;
            let trim_end = (original - (payload.end_time * 10_000_000.0) as i64).max(0);
            track
                .SetTrimTimeFromEnd(TimeSpan { Duration: trim_end })
                .map_err(|error| crate::Error::Message(error.to_string()))?;
        }
        let tracks = composition
            .BackgroundAudioTracks()
            .map_err(|error| crate::Error::Message(error.to_string()))?;
        tracks
            .Append(&track)
            .map_err(|error| crate::Error::Message(error.to_string()))?;
        if payload.loop_audio {
            let segment = track
                .TrimmedDuration()
                .map_err(|error| crate::Error::Message(error.to_string()))?
                .Duration
                .max(1);
            let total = (payload.duration.max(0.0) * 10_000_000.0) as i64;
            let mut delay = segment;
            while delay < total {
                let clone = track
                    .Clone()
                    .map_err(|error| crate::Error::Message(error.to_string()))?;
                clone
                    .SetDelay(TimeSpan { Duration: delay })
                    .map_err(|error| crate::Error::Message(error.to_string()))?;
                tracks
                    .Append(&clone)
                    .map_err(|error| crate::Error::Message(error.to_string()))?;
                delay += segment;
            }
        }
    }

    let output = StorageFile::GetFileFromPathAsync(&HSTRING::from(&payload.output_path))
        .map_err(|error| crate::Error::Message(error.to_string()))?
        .get()
        .map_err(|error| crate::Error::Message(error.to_string()))?;
    let profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::Auto)
        .map_err(|error| crate::Error::Message(error.to_string()))?;
    let result = composition
        .RenderToFileWithProfileAsync(&output, MediaTrimmingPreference::Precise, &profile)
        .map_err(|error| crate::Error::Message(error.to_string()))?
        .get()
        .map_err(|error| crate::Error::Message(error.to_string()))?;
    if result != TranscodeFailureReason::None {
        return Err(crate::Error::Message(format!(
            "Windows native video export failed: {result:?}"
        )));
    }
    Ok(TranscodeResponse {
        output_path: payload.output_path,
        encoder: "Windows Media Foundation H.264".into(),
    })
}
