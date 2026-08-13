# Photo Wall native-video plugin

Local MP4 export bridge used by Photo Wall:

- Windows: MediaComposition / Media Foundation
- Android: Media3 Transformer backed by MediaCodec
- iOS: AVFoundation

The web layer records Timeline frames and stages the video and optional music
in the application cache. This plugin produces H.264/AAC MP4 output; callers
fall back to the bundled browser encoder if the platform codec rejects input.
