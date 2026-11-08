import type { AgentAnswer } from '../../automation/caller'
import { invoke } from '../../tauri'
import { type Version, versionsOf, versionText } from '../../versions'
import { workspace } from '../../workspace.svelte'
import { notes } from '../docs'
import { asked } from './asks'
import { readable } from './guarded'
import { type Call, done, need, writerOf } from './call'
import { Refused } from './problem'
import { judged, onDisk, type Place, placeOf, sharedSource, writableAt } from './spaces'
import { notePath } from '../../space-paths'

function idOf(version: Version): string {
  return `${version.path === null ? 'account' : 'device'}:${version.at}`
}

function noteOf(call: Call): { place: Place; relative: string; path: string } {
  const place = placeOf(call)
  const asked = judged(need(call, 'path'))
  const relative = notePath(asked) ?? asked
  const path = onDisk(place, relative)
  readable(path, relative)
  return { place, relative, path }
}

export async function listVersions(call: Call): Promise<AgentAnswer> {
  const { place, relative, path } = noteOf(call)
  const versions = await versionsOf(path)

  return done(
    versions.map((one) => ({
      version: idOf(one),
      at: new Date(one.at).toISOString(),
      size: one.size,
      by: one.by || (one.path === null ? 'account' : 'this device'),
    })),
    sharedSource(place, relative),
  )
}

export async function restoreVersion(call: Call): Promise<AgentAnswer> {
  const { place, relative, path } = noteOf(call)
  writableAt(place, path)
  const wanted = need(call, 'version')
  const version = (await versionsOf(path)).find((one) => idOf(one) === wanted)
  if (!version) {
    throw new Refused('no_such_version', `${relative} has no version ${wanted}: list_versions`)
  }

  const words = await versionText(version, path)
  const now = await workspace.noteText(path)
  if (now === null) throw new Refused('no_such_file', `there is no note at ${relative}`)

  const when = new Date(version.at).toISOString().slice(0, 16).replace('T', ' ')
  const question = await asked(call, 'deleting', `Put back ${relative} as it was at ${when}`)
  if (question) return question

  const agent = call.caller.agent
  await invoke('snapshot_note', { path, content: now, source: agent?.name }).catch(() => undefined)

  const wrote = await notes.writeNote(
    writerOf(call),
    { path: relative, space: place.space.id },
    words,
  )
  return done({ ...wrote, restored: wanted })
}
