import { mount, unmount } from 'svelte'
import { t } from '../i18n.svelte'
import { workspace } from '../workspace.svelte'
import { hashPassword, matches } from './password'
import PasswordSheet from './PasswordSheet.svelte'
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

export async function unlockAt(path: string, typed: string): Promise<boolean> {
  if (!(await passwordOpens(typed))) return false
  unlocks.unlock(workspace.protection.covering(path))
  return true
}

async function opened(path: string): Promise<boolean> {
  const locks = workspace.protection.covering(path)
  if (!unlocks.shut(locks)) return true
  if ((await asked(false, t('Unlock'))) === null) return false
  unlocks.unlock(locks)
  return true
}

export async function protect(root: string, path: string): Promise<void> {
  if (!workspace.protection.password) {
    const chosen = await asked(true, t('Choose a password'))
    if (chosen === null) return
    workspace.protection.setPassword(await hashPassword(chosen))
  }
  workspace.protection.set(root, path, 'password')
  const own = workspace.protection.own(root, path)
  if (own) unlocks.unlock([own])
}

export async function unprotect(root: string, path: string): Promise<void> {
  if (!(await opened(path))) return
  workspace.protection.set(root, path, null)
}
