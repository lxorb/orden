import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OURS = 'so.orden.Orden.'
const PERMISSION = 'android.permission.'
const ACTION = 'android.intent.action.'
const SHARED = ['MainActivity', `${PERMISSION}INTERNET`, `${PERMISSION}POST_NOTIFICATIONS`]
const NOTES = ['NewNoteTile', 'SearchTile', 'RecordTile', 'NotesWidget']
const MICROPHONE = [`${PERMISSION}RECORD_AUDIO`, `${PERMISSION}MODIFY_AUDIO_SETTINGS`]
const REMINDERS = ['ReminderReceiver', `${PERMISSION}SCHEDULE_EXACT_ALARM`, `${PERMISSION}RECEIVE_BOOT_COMPLETED`]
const SHARING = [`${ACTION}SEND`, `${ACTION}SEND_MULTIPLE`]
const CARRIED = {
  orden: [...SHARED, ...NOTES, ...MICROPHONE, ...REMINDERS, ...SHARING, 'TodayWidget'],
  notes: [...SHARED, ...NOTES, ...MICROPHONE, ...SHARING],
  track: [...SHARED, 'TrackTile', 'TrackReceiver', 'TrackWidget'],
  todo: [...SHARED, ...MICROPHONE, ...REMINDERS, `${ACTION}SEND`, 'AddTodoTile', 'TodayWidget'],
  chat: [...SHARED, ...MICROPHONE, 'ChatMessages', 'ChatActionReceiver'],
}
const SCHEMES = { orden: 'orden', notes: 'orden', track: 'orden-track', todo: 'orden-todo', chat: 'orden-chat' }
const EVERY = [...new Set(Object.values(CARRIED).flat())]
const full = (name) => (name.includes('.') ? name : `${OURS}${name}`)
export function judge(app, manifest, links = false) {
  const carried = CARRIED[app]
  if (!carried) return [`${app} has no list of what its manifest carries`]
  const names = new Set([...manifest.matchAll(/android:name(?:\(0x[0-9a-f]+\))?="([^"]+)"/g)].map((one) => one[1]))
  const schemes = [...manifest.matchAll(/android:scheme(?:\(0x[0-9a-f]+\))?="([^"]+)"/g)].map((one) => one[1])
  const ours = [...names].filter((name) => name.startsWith(OURS) && !name.endsWith('_PERMISSION'))
  return [
    ...carried.filter((name) => !names.has(full(name))).map((name) => `${app} lacks ${full(name)}`),
    ...EVERY.filter((name) => !carried.includes(name) && names.has(full(name))).map(
      (name) => `${app} carries ${full(name)}`,
    ),
    ...ours
      .filter((name) => !EVERY.map(full).includes(name))
      .map((name) => `${app} carries ${name}, which no list names`),
    ...(!links || (schemes.length > 0 && schemes.every((one) => one === SCHEMES[app]))
      ? []
      : [`${app} opens ${schemes.join(', ') || 'no links'}, not only ${SCHEMES[app]}://`]),
  ]
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [app, path, mode] = process.argv.slice(2)
  if (!app || !path) {
    console.error(
      'usage: node scripts/phone-manifest.mjs <app> <merged AndroidManifest.xml or aapt2 xmltree dump> [--links]',
    )
    process.exit(2)
  }
  const problems = judge(app, readFileSync(path, 'utf8'), mode === '--links')
  for (const problem of problems) console.error(problem)
  if (!problems.length) console.log(`${app} carries what it should and nothing else of Orden's`)
  process.exit(problems.length ? 1 : 0)
}
