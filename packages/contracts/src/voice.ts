export interface VoiceRecording {
  readonly extension: string
  stop(): Promise<{ bytes: ArrayBuffer; seconds: number }>
}

export interface VoicePort {
  record(): Promise<VoiceRecording>
  wordsIn(bytes: ArrayBuffer): Promise<string>
}

export interface VoicePorts {
  readonly voice: VoicePort
}
