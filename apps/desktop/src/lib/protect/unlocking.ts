import { mount, unmount } from 'svelte'
import { busy } from '../busy.svelte'
import { prompt } from '../prompt.svelte'
import { workspace } from '../workspace.svelte'
import { deviceCan, deviceName, deviceSays } from './device'
import { hashPassword, matches } from './password'
import PasswordSheet from './PasswordSheet.svelte'
import type { Way } from './protection.svelte'
import { unlocks } from './unlocked.svelte'

function asked(choosing: boolean, title: string): Promise<string | null> {
  return new Promise((resolve) => {
    const sheet = mount(PasswordSheet, {
      target: document.body,
      props: {
        choosing,
        title,
        check: passwordOpens,
        onanswer: (typed: string | null) => {
          resolve(typed)
          setTimeout(() => void unmount(sheet, { outro: true }), 0)
        },
      },
    })
  })
}

async function passwordOpens(typed: string): Promise<boolean> {
  const kept = workspace.protection.password
  return kept !== null && (await matches(typed, kept))
}

const ownerSays = () =>
  busy.run(`Waiting for ${deviceName()}…`, () => deviceSays('Unlock what you protected in Orden'))

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const couldNotAsk = (error: unknown) =>
  busy.failed(`${deviceName()} could not be asked: ${reasonOf(error)}`)

const turnedAway = () => busy.failed(`${deviceName()} did not confirm it was you`)

async function ownerOpens(): Promise<boolean | null> {
  try {
    if (await ownerSays()) return true
    turnedAway()
    return false
  } catch (error) {
    couldNotAsk(error)
    return null
  }
}

export async function unlockAt(path: string, typed: string): Promise<boolean> {
  if (!(await passwordOpens(typed))) return false
  unlocks.unlock(workspace.protection.covering(path))
  return true
}

export async function unlockByDevice(path: string): Promise<boolean> {
  if ((await ownerOpens()) !== true) return false
  unlocks.unlock(workspace.protection.covering(path))
  return true
}

async function opened(path: string): Promise<boolean> {
  const locks = workspace.protection.covering(path)
  if (!unlocks.shut(locks)) return true
  const open =
    ((await deviceCan()) && (await ownerOpens()) === true) ||
    (workspace.protection.password !== null && (await asked(false, 'Unlock')) !== null)
  if (open) unlocks.unlock(locks)
  return open
}

async function wayFor(): Promise<Way | null> {
  if (await deviceCan()) {
    const picked = await prompt.choose({
      title: 'Protect with',
      detail: 'Protected, not encrypted: this only keeps it from being opened by accident.',
      options: [
        { id: 'device', label: deviceName(), primary: true },
        { id: 'password', label: 'Password' },
      ],
    })
    if (picked === null) return null
    if (picked === 'device') {
      const said = await ownerOpens()
      if (said !== null) return said ? 'device' : null
    }
  }
  if (workspace.protection.password) return 'password'
  const chosen = await asked(true, 'Choose a password')
  if (chosen === null) return null
  workspace.protection.setPassword(await hashPassword(chosen))
  return 'password'
}

const cannotProtect = (error: unknown) =>
  busy.failed(`That could not be protected: ${reasonOf(error)}`)

export async function protect(root: string, path: string): Promise<void> {
  const way = await wayFor().catch((error: unknown) => {
    cannotProtect(error)
    return null
  })
  if (way === null) return
  workspace.protection.set(root, path, way)
  const own = workspace.protection.own(root, path)
  if (own) unlocks.unlock([own])
}

export async function unprotect(root: string, path: string): Promise<void> {
  if (!(await opened(path))) return
  workspace.protection.set(root, path, null)
}
