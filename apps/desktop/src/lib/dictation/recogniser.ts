/** The browser's speech recogniser, under either of its two names, or nothing where the
 *  browser has none. Answered as the constructor rather than as a boolean because the
 *  callers build one from it: one place knows the two spellings. A leaf, so the fields
 *  that ask whether this device can hear carry nothing else (engines.svelte.ts), and the
 *  note's dictation asks the same (mobile/dictation.ts). */
export function speechRecogniser(): unknown {
  const held = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const found = held.SpeechRecognition ?? held.webkitSpeechRecognition

  return typeof found === 'function' ? found : undefined
}
