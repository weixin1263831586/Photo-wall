import AVFoundation
import SwiftRs
import Tauri
import UIKit
import WebKit

class TranscodeArgs: Decodable {
  let inputPath: String
  let outputPath: String
  let audioPath: String?
  let duration: Double
  let volume: Double
  let startTime: Double
  let loopAudio: Bool
  let fadeIn: Double
  let fadeOut: Double
}

enum NativeVideoError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self { case .message(let value): return value }
  }
}

class ExamplePlugin: Plugin {
  @objc public func capabilities(_ invoke: Invoke) {
    invoke.resolve([
      "available": true,
      "platform": "ios",
      "encoder": "AVFoundation / AVAssetExportSession"
    ])
  }

  @objc public func transcode(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TranscodeArgs.self)
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try self.export(args)
        invoke.resolve([
          "outputPath": args.outputPath,
          "encoder": "iOS AVFoundation H.264 / AAC"
        ])
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  private func export(_ args: TranscodeArgs) throws {
    let inputURL = URL(fileURLWithPath: args.inputPath)
    let outputURL = URL(fileURLWithPath: args.outputPath)
    guard FileManager.default.fileExists(atPath: inputURL.path) else {
      throw NativeVideoError.message("Native encoder input file is missing")
    }
    try? FileManager.default.removeItem(at: outputURL)
    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    let inputAsset = AVURLAsset(url: inputURL)
    guard let sourceVideo = inputAsset.tracks(withMediaType: .video).first else {
      throw NativeVideoError.message("iOS cannot decode the recorded video")
    }
    let composition = AVMutableComposition()
    guard let videoTrack = composition.addMutableTrack(
      withMediaType: .video,
      preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
      throw NativeVideoError.message("Unable to create the iOS video track")
    }
    let videoDuration = inputAsset.duration
    try videoTrack.insertTimeRange(
      CMTimeRange(start: .zero, duration: videoDuration),
      of: sourceVideo,
      at: .zero
    )
    videoTrack.preferredTransform = sourceVideo.preferredTransform

    var audioMix: AVMutableAudioMix?
    if let audioPath = args.audioPath, FileManager.default.fileExists(atPath: audioPath) {
      let audioAsset = AVURLAsset(url: URL(fileURLWithPath: audioPath))
      if let sourceAudio = audioAsset.tracks(withMediaType: .audio).first,
         let audioTrack = composition.addMutableTrack(
          withMediaType: .audio,
          preferredTrackID: kCMPersistentTrackID_Invalid
         ) {
        let start = CMTime(seconds: max(0, args.startTime), preferredTimescale: 600)
        let available = CMTimeMaximum(.zero, CMTimeSubtract(audioAsset.duration, start))
        var cursor = CMTime.zero
        repeat {
          let remaining = CMTimeSubtract(videoDuration, cursor)
          let segment = CMTimeMinimum(available, remaining)
          if CMTimeCompare(segment, .zero) <= 0 { break }
          try audioTrack.insertTimeRange(CMTimeRange(start: start, duration: segment), of: sourceAudio, at: cursor)
          cursor = CMTimeAdd(cursor, segment)
        } while args.loopAudio && CMTimeCompare(cursor, videoDuration) < 0

        let parameters = AVMutableAudioMixInputParameters(track: audioTrack)
        let volume = Float(min(1, max(0, args.volume)))
        parameters.setVolume(volume, at: .zero)
        let fadeIn = CMTime(seconds: min(max(0, args.fadeIn), CMTimeGetSeconds(videoDuration) / 2), preferredTimescale: 600)
        if CMTimeCompare(fadeIn, .zero) > 0 {
          parameters.setVolumeRamp(fromStartVolume: 0, toEndVolume: volume, timeRange: CMTimeRange(start: .zero, duration: fadeIn))
        }
        let fadeOutSeconds = min(max(0, args.fadeOut), CMTimeGetSeconds(videoDuration) / 2)
        if fadeOutSeconds > 0 {
          let fadeOut = CMTime(seconds: fadeOutSeconds, preferredTimescale: 600)
          parameters.setVolumeRamp(
            fromStartVolume: volume,
            toEndVolume: 0,
            timeRange: CMTimeRange(start: CMTimeSubtract(videoDuration, fadeOut), duration: fadeOut)
          )
        }
        let mix = AVMutableAudioMix()
        mix.inputParameters = [parameters]
        audioMix = mix
      }
    }

    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw NativeVideoError.message("Unable to initialize AVFoundation exporter")
    }
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    exporter.audioMix = audioMix

    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    if exporter.status != .completed {
      throw exporter.error ?? NativeVideoError.message("iOS native video export failed")
    }
  }
}

@_cdecl("init_plugin_native_video")
func initPlugin() -> Plugin {
  return ExamplePlugin()
}
