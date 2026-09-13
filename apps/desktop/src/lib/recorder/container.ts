/** What the platform will record into, and what to call the file.
 *
 *  Two containers, because there are two engines behind the three builds and each
 *  will only write one of them. Chromium - the desktop's WebView2, Android's
 *  WebView, every browser but Safari - writes Opus in a WebM container, which is
 *  the best sound per byte anything ships. WKWebView on macOS and iOS writes AAC
 *  in an MP4 and has never had Opus. So the list is asked in order and the first
 *  the platform admits to is used; nothing here assumes which one that will be.
 *
 *  The extension matters more than it looks. `![[take.webm]]` is a *film* to every
 *  surface in nib and to Obsidian both - a `.webm` usually holds one, and
 *  `packages/markdown/src/links.ts` says so - and a film embed draws a black
 *  rectangle with a play button over sound that has no picture. `.weba` is the
 *  spelling that says sound, so that is what a recording is called and what makes
 *  the embed the audio player it should be. An `audio/mp4` recording is `.m4a` for
 *  the same reason.
 *
 *  Pure, and tested as such: what a platform offers is asked of `MediaRecorder`
 *  once, and everything else here is arithmetic on a string. */

/** The containers, in the order they are asked for.
 *
 *  Opus first at both ends: the codec is named where naming it is allowed, because
 *  a bare `audio/webm` on some builds means Vorbis, and then the bare type as the
 *  fallback for a build that refuses the parameter. */
const CONTAINERS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

/** What a recording of each type is called on disk. Read off the type rather than
 *  remembered beside it, because the type a recorder actually used is the
 *  recorder's own answer and not always the one it was asked for. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/webm': 'weba',
  'audio/ogg': 'oga',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

/** Sound, and nothing else. A build with no sound-only container would otherwise
 *  be handed a video one and write a film of a black screen. */
const FALLBACK = 'weba'

/** The extension for a recorder's own `mimeType`, which arrives as
 *  `audio/webm;codecs=opus` and is a type with something after it. */
export function extensionOf(type: string): string {
  const family = type.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[family] ?? FALLBACK
}

/** The best container this platform will record into, or null where it records
 *  into none: a build with no `MediaRecorder` at all, and the one case where the
 *  row is not offered rather than offered and failing.
 *
 *  The empty string is a real answer, and the important one: a `MediaRecorder`
 *  made with no type at all writes the platform's own default, which is what an
 *  engine that refuses every name above still has. What it chose is read back off
 *  the recorder afterwards. */
export function bestContainer(): string | null {
  if (typeof MediaRecorder === 'undefined') return null

  for (const type of CONTAINERS) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }

  return ''
}

/** Whether this device can record at all: a microphone to open and a container to
 *  write it into.
 *
 *  Here rather than on the recorder, because it is the one question about recording
 *  the app has to answer before anything is fetched - a menu greys its Record row out
 *  on a build with no `MediaRecorder` - and the recorder is a subsystem nothing
 *  carries until somebody presses the row. `mediaDevices` is typed as always there and
 *  is absent in a page served over plain http from anything but localhost, so it is
 *  asked for rather than assumed, which is also what makes this answerable in a test
 *  with no browser behind it. */
export function canRecordHere(): boolean {
  const devices: MediaDevices | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.mediaDevices

  return !!devices && bestContainer() !== null
}

/** Two digits, for a name a person reads and a machine sorts. */
function padded(value: number): string {
  return String(value).padStart(2, '0')
}

/** What a recording is called: `recording-2026-09-12-1432.weba`.
 *
 *  The date and the time to the minute, in the reader's own clock rather than in
 *  UTC, because the name is read beside the note it was made in. Not the hash a
 *  pasted picture is named by: two pastes of one picture are the same bytes and
 *  should be one file, while two recordings never are, and a hash would name a
 *  thing nobody can find again in a folder.
 *
 *  Seconds are left out. A name is something to read, the minute is enough to tell
 *  two recordings apart in a folder, and where it is not, the command that writes
 *  the file steps the name rather than overwriting; see `save_asset`. */
export function recordingName(at: Date, extension: string): string {
  const stamp = [
    at.getFullYear(),
    padded(at.getMonth() + 1),
    padded(at.getDate()),
    `${padded(at.getHours())}${padded(at.getMinutes())}`,
  ].join('-')

  return `recording-${stamp}.${extension}`
}
