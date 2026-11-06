import {
  type AppRun,
  appFileText,
  CATALOGUE_PATH,
  catalogueOf,
  type Installed,
} from '@orden/online/apps'
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
    options: computers.map((one) => {
      const name = one.current ? t('{device} (this device)', { device: one.name }) : one.name
      const label =
        one.platform === 'macos'
          ? t('{device}: cannot run applications yet', { device: name })
          : name
      return { id: one.id, label, primary: one.current && one.platform !== 'macos' }
    }),
  })
  if (!host) return null

  const here = computers.find((one) => one.id === host)?.current ?? false
  const installed = await installedOn(host, here, token)
  let run: AppRun | null = null
  if (installed.length) {
    const picked = await prompt.find({
      title: t('What does it run?'),
      placeholder: t('Find an application'),
      options: [
        ...installed.map((one) => ({
          id: one.id,
          label: one.name,
          ...(one.icon ? { picture: one.icon } : { mark: 'application' as const }),
        })),
        { id: ANOTHER, label: t('Another program…') },
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
          ? t('What does it run?')
          : t('{device} has not listed its applications yet. What does it run?', { device }),
      placeholder: t('A program’s path, and its arguments'),
    })
    const program = line === null ? null : programOf(line)
    if (!program) return null
    run = { kind: 'path', ...program, cwd: null }
  }

  const name =
    (run.kind === 'installed' ? run.name : nameOf(run.path).replace(/\.(exe|app)$/i, '')) ||
    t('Application')
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
    const { invoke, isDesktop } = await import('../tauri')
    if (!isDesktop) return []
    const listed = await invoke<unknown>('apps_installed').catch(() => null)
    return catalogueOf(listed) ?? []
  }
  const { request } = await import('../api')
  const answered = await request<{ apps?: unknown }>(
    `${CATALOGUE_PATH}/${encodeURIComponent(host)}`,
    { token },
  ).catch(() => null)
  return catalogueOf(answered?.apps) ?? []
}
