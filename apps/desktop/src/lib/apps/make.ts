import {
  type AppRun,
  appFileText,
  CATALOGUE_PATH,
  catalogueOf,
  type Installed,
} from '@orden/online/apps'
import { account } from '../accounts/src/api'
import { canWriteAt } from '../sharing/src/api'
import { nameOf, joinPath } from '../platform/src/api'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { openApplication } from './open'
import { type Computer, hostChoices, mayHost, programOf } from './words'

export async function makeApplication(): Promise<Tab | null> {
  const token = account.accountToken
  if (!token) {
    account.ask()
    return null
  }
  const root = workspace.activeSpace?.root
  if (!root || !canWriteAt(root)) return null

  const { request } = await import('../accounts/src/api')
  const { prompt } = await import('../ui-kit/src/api')
  const listed = await request<{ devices?: Computer[] }>('/v2/devices', { token }).catch(() => null)
  const computers = (listed?.devices ?? []).filter((one) => mayHost(one.platform))
  if (!computers.length) {
    await prompt.choose({
      title: 'None of your devices can run an application yet',
      options: [{ id: 'ok', label: 'OK', primary: true }],
    })
    return null
  }

  const host = await prompt.choose({
    title: 'Where does it run?',
    options: hostChoices(computers, (device) => `${device} (this device)`),
  })
  if (!host) return null

  const here = computers.find((one) => one.id === host)?.current ?? false
  const installed = await installedOn(host, here, token)
  let run: AppRun | null = null
  if (installed.length) {
    const picked = await prompt.find({
      title: 'What does it run?',
      placeholder: 'Find an application',
      options: [
        ...installed.map((one) => ({
          id: one.id,
          label: one.name,
          ...(one.icon ? { picture: one.icon } : { mark: 'application' as const }),
        })),
        { id: ANOTHER, label: 'Another program…' },
      ],
    })
    if (picked === null) return null
    const app = installed.find((one) => one.id === picked)
    if (app) run = { kind: 'installed', id: app.id, name: app.name }
  }
  if (!run) {
    const device = computers.find((one) => one.id === host)?.name ?? ''
    const line = await prompt.ask({
      title:
        installed.length || here
          ? 'What does it run?'
          : `${device} has not listed its applications yet. What does it run?`,
      placeholder: 'A program’s path, and its arguments',
    })
    const program = line === null ? null : programOf(line)
    if (!program) return null
    run = { kind: 'path', ...program, cwd: null }
  }

  const name =
    (run.kind === 'installed' ? run.name : nameOf(run.path).replace(/\.(exe|app)$/i, '')) ||
    'Application'
  const path = joinPath(root, await workspace.freeNameOnDisk(root, `${name}.application`))
  await writeFile(path, appFileText({ v: 1, host, run }))
  await workspace.fileCame(path, 'file')
  const tab = openApplication(path)
  void workspace.loadTree()
  return tab
}

const ANOTHER = '\u0000another'

async function installedOn(host: string, here: boolean, token: string): Promise<Installed[]> {
  if (here) {
    const { invoke, isDesktop } = await import('../platform/src/api')
    if (!isDesktop) return []
    const listed = await invoke<unknown>('apps_installed').catch(() => null)
    return catalogueOf(listed) ?? []
  }
  const { request } = await import('../accounts/src/api')
  const answered = await request<{ apps?: unknown }>(
    `${CATALOGUE_PATH}/${encodeURIComponent(host)}`,
    { token },
  ).catch(() => null)
  return catalogueOf(answered?.apps) ?? []
}
