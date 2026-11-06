const DEFAULTS = {
  setLanguage: 'Set the language',
  fenceLanguage: 'language',
  copy: 'Copy',
  copyCode: 'Copy code',
  copied: 'Copied',
  run: 'Run',
  runCode: 'Run the code',
  running: 'Running…',
  ask: 'Ask',
  askModel: 'Ask the model',
  aiAnswered: 'answered by {model}, {date}',
  stop: 'Stop',
  stopped: 'Stopped',
  result: 'Result',
  timedOut: 'Timed out after {seconds} s',
  outputTruncated: 'Only the first {count} lines are kept',
  dismiss: 'Dismiss',
  keep: 'Keep',
  undo: 'Undo',
  fold: 'Fold',
  unfold: 'Unfold',
  blockHandle: 'Move this block',
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
  openNote: 'Ctrl+Click to open the note',
  openNoteMac: '⌘-click to open the note',
  createNote: 'Ctrl+Click to create the note',
  createNoteMac: '⌘-click to create the note',
  searchTag: 'Ctrl+Click to search the tag',
  searchTagMac: '⌘-click to search the tag',
  noteNotFound: 'Note not found',
  archived: 'Archived',
  loadingNote: 'Loading…',
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
  sortColumn: 'Sort by this column',
  addProperty: 'Add a property',
  property: 'property',
  properties: 'Properties',
  addToList: 'Add',
  removeFromList: 'Remove',
  dragCover: 'Drag to reposition',
  taskDone: 'Done',
  taskDoneOn: 'done {date}',
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
}

export type LabelKey = keyof typeof DEFAULTS

export const LABEL_KEYS = Object.keys(DEFAULTS) as LabelKey[]

export const englishLabel = (key: LabelKey): string => DEFAULTS[key]

let current: Record<LabelKey, string> = { ...DEFAULTS }

export function setLabels(labels: Partial<Record<LabelKey, string>>) {
  current = { ...DEFAULTS, ...labels }
}

export function label(key: LabelKey): string {
  return current[key]
}
