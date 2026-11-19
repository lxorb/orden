export { default as DictateButton } from './DictateButton.svelte'
export { canDictate, engines, showsDictateButton, type Engine } from './engines.svelte'
export { dictating } from './keys'
export { local } from './local.svelte'
export { voice, type Dictates } from './voice.svelte'
export { recordRows, transcribeRows } from './recorder/commands'
export { record as recordVoice } from './recorder/microphone'
export { appendTo } from './recorder/note'
export const transcriber = () => import('./recorder/transcribe')
export const loadRecordingPill = () => import('./recorder/RecordingPill.svelte')
