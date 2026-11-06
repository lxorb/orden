export function speechRecogniser(): unknown {
  const held = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const found = held.SpeechRecognition ?? held.webkitSpeechRecognition

  return typeof found === 'function' ? found : undefined
}
