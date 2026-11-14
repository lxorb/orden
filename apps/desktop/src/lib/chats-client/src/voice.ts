import { portOf, type VoiceRecording } from '@orden/contracts'

export function recordVoice(): Promise<VoiceRecording> {
  const voice = portOf('voice')
  return voice.ok ? voice.value.record() : Promise.reject(new Error(voice.error.message))
}

export function wordsInVoice(bytes: ArrayBuffer): Promise<string> {
  const voice = portOf('voice')
  return voice.ok ? voice.value.wordsIn(bytes) : Promise.reject(new Error(voice.error.message))
}
