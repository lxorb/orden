/** The few words the editor's own widgets show. The app hands over translated
 *  ones at startup; on their own they read as English. */
const DEFAULTS = {
  setLanguage: 'Set the language',
  copy: 'Copy',
  copyCode: 'Copy code',
  copied: 'Copied',
  run: 'Run',
  runCode: 'Run the code',
  running: 'Running…',
  stop: 'Stop',
  stopped: 'Stopped',
  result: 'Result',
  timedOut: 'Timed out after {seconds} s',
  outputTruncated: 'Only the first {count} lines are kept',
  dismiss: 'Dismiss',
  dragToResize: 'Drag to resize',
  describeImage: 'Describe the image',
  openImage: 'Open image',
  copyLink: 'Copy link',
  editMarkdown: 'Edit markdown',
  deleteImage: 'Delete image',
  resetSize: 'Reset size',
  imageNotFound: 'Image not found',
  openLink: 'Ctrl+Click to open the link',
  openLinkMac: '⌘-click to open the link',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  moveColumnLeft: 'Move column left',
  moveColumnRight: 'Move column right',
  insertColumn: 'Insert column',
  deleteColumn: 'Delete column',
  moveRowUp: 'Move row up',
  moveRowDown: 'Move row down',
  insertRow: 'Insert row',
  deleteRow: 'Delete row',
}

export type LabelKey = keyof typeof DEFAULTS

/** Every key, so the app knows what to translate without repeating the list. */
export const LABEL_KEYS = Object.keys(DEFAULTS) as LabelKey[]

/** The English wording, which doubles as the lookup key on the app's side. */
export const englishLabel = (key: LabelKey): string => DEFAULTS[key]

let current: Record<LabelKey, string> = { ...DEFAULTS }

/** Replaces the labels. Anything not given keeps its English wording. */
export function setLabels(labels: Partial<Record<LabelKey, string>>) {
  current = { ...DEFAULTS, ...labels }
}

export function label(key: LabelKey): string {
  return current[key]
}
