import { log } from '../log'
import { canWriteAt } from '../sharing.svelte'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { arrivalOf } from './arrival'

export async function hearPdfs(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const stop = await getCurrentWindow().listen<unknown>('nib://open-pdfs', (event) => {
    void showPdfs(event.payload)
  })

  void showPdfs(await invoke<unknown>('take_startup_pdfs').catch(() => []))
  return stop
}

export async function showPdfs(said: unknown) {
  if (!Array.isArray(said)) return

  for (const path of said) {
    if (typeof path === 'string' && path) await showPdf(path)
    else log('warn', `pdf: a file handed over was not one: ${String(path)}`)
  }
}

async function showPdf(handed: string) {
  const arrival = arrivalOf(handed, workspace.spaces, workspace.activeSpaceId, canWriteAt)
  if (arrival && arrival.spaceId !== workspace.activeSpaceId) {
    await workspace.selectSpace(arrival.spaceId)
  }
  if (arrival?.kind === 'open') {
    await workspace.openPdf(arrival.path)
    return
  }

  const same = arrival ? await workspace.samePdfIn(handed, arrival.root) : null
  if (same) await workspace.openPdf(same)
  else await workspace.draftPdf(handed)
}
