/** Making an application (docs/apps.md): developer mode's new tab card. Which of the
 *  reader's computers it runs on, then what: a program by its path and its arguments
 *  (the list of what each computer has installed comes with its host, issue 1063). The
 *  file is written in the folder new notes go to, named after the program, and opened. */

import { appFileText } from '@orden/online/apps'
import { account } from '../account.svelte'
import { t } from '../i18n.svelte'
import { canWriteAt } from '../sharing.svelte'
import { nameOf } from '../space-paths'
import { joinPath } from '../tauri'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { openApplication } from './open'
import { mayHost, programOf } from './words'

interface Listed {
  id: string
  name: string
  platform: string
  current: boolean
}

export async function makeApplication(): Promise<Tab | null> {
  const token = account.accountToken
  if (!token) {
    account.ask()
    return null
  }
  const root = workspace.activeSpace?.root
  if (!root || !canWriteAt(root)) return null

  const { request } = await import('../api')
  const { prompt } = await import('../prompt.svelte')
  const listed = await request<{ devices?: Listed[] }>('/v2/devices', { token }).catch(() => null)
  const computers = (listed?.devices ?? []).filter((one) => mayHost(one.platform))
  if (!computers.length) {
    await prompt.choose({
      title: t('None of your devices can run an application yet'),
      options: [{ id: 'ok', label: t('OK'), primary: true }],
    })
    return null
  }

  const host = await prompt.choose({
    title: t('Where does it run?'),
    options: computers.map((one) => ({
      id: one.id,
      label: one.current ? t('{device} (this device)', { device: one.name }) : one.name,
      primary: one.current,
    })),
  })
  if (!host) return null

  const line = await prompt.ask({
    title: t('What does it run?'),
    placeholder: t('A program’s path, and its arguments'),
  })
  const program = line === null ? null : programOf(line)
  if (!program) return null

  const name = nameOf(program.path).replace(/\.(exe|app)$/i, '') || t('Application')
  const path = joinPath(root, await workspace.freeNameOnDisk(root, `${name}.application`))
  await writeFile(path, appFileText({ v: 1, host, run: { kind: 'path', ...program, cwd: null } }))
  await workspace.fileCame(path, 'file')
  const tab = openApplication(path)
  void workspace.loadTree()
  return tab
}
