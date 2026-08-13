import { invoke } from '@tauri-apps/api/core'

export interface NativeVideoCapabilities {
  available: boolean
  platform: 'windows' | 'android' | 'ios' | string
  encoder: string
}

export interface TranscodeRequest {
  inputPath: string
  outputPath: string
  audioPath?: string | null
  duration: number
  volume: number
  startTime: number
  loopAudio: boolean
  fadeIn: number
  fadeOut: number
}

export interface TranscodeResponse {
  outputPath: string
  encoder: string
}

export function capabilities(): Promise<NativeVideoCapabilities> {
  return invoke<NativeVideoCapabilities>('plugin:native-video|capabilities')
}

export function transcode(payload: TranscodeRequest): Promise<TranscodeResponse> {
  return invoke<TranscodeResponse>('plugin:native-video|transcode', { payload })
}
