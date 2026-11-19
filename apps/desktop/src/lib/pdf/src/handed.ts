import { plainWords } from '@orden/markdown/escapes'
import { log, invoke, isMarkdownPath, nameOf } from '../../platform/src/api'
import { canWriteAt } from '../../sharing/src/api'
import { workspace } from '../../workspace/src/api'
import { arrivalOf } from './arrival'

export async function hearPdfs(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const stop = await getCurrentWindow().listen<unknown>('orden://open-pdfs', (event) => {
    void showPdfs(event.payload)
  })
  void showPdfs(await invoke<unknown>('take_startup_pdfs').catch(() => []))
  return stop
}
export async function showPdfs(said: unknown) {
  if (!Array.isArray(said)) return
  for (const path of said) {
    if (typeof path === 'string' && /\.pdf$/i.test(path)) await showPdf(path)
    else if (typeof path === 'string' && path) await showText(path)
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
async function showText(handed: string) {
  const arrival = arrivalOf(handed, workspace.spaces, workspace.activeSpaceId, canWriteAt)
  if (arrival && arrival.spaceId !== workspace.activeSpaceId) {
    await workspace.selectSpace(arrival.spaceId)
  }
  const markdown = isMarkdownPath(handed)
  if (arrival?.kind === 'open' && markdown) {
    await workspace.open(arrival.path)
    return
  }
  const bytes = await invoke<ArrayBuffer>('read_file', { path: handed }).catch(() => null)
  if (bytes === null) {
    log('warn', `pdf: a text file handed over could not be read: ${handed}`)
    return
  }
  const text = new TextDecoder().decode(bytes)
  workspace.openBlank(nameOf(handed).replace(/\.[^.]+$/, ''), markdown ? text : plainWords(text))
}
