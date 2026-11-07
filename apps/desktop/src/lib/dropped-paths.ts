import { nameOf } from './space-paths'
import { invoke } from './tauri'

const ASKED = 'orden-dropped-paths'
const TRIES = 20
const APART = 50

interface WebView2 {
  postMessageWithAdditionalObjects?: (message: string, objects: readonly File[]) => void
}

export interface Asking {
  view: WebView2 | undefined
  ask: () => Promise<string[]>
  wait: (ms: number) => Promise<void>
}

const asking: Asking = {
  view: (globalThis as { chrome?: { webview?: WebView2 } }).chrome?.webview,
  ask: () => invoke<string[]>('dropped_paths').catch(() => []),
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
}

export async function droppedPaths(
  files: readonly File[],
  how: Asking = asking,
): Promise<string[]> {
  if (!files.length) return []

  how.view?.postMessageWithAdditionalObjects?.(ASKED, files)
  const names = new Set(files.map((one) => one.name))
  for (let tries = 0; tries < TRIES; tries++) {
    const said: unknown = await how.ask()
    const paths = Array.isArray(said)
      ? said.filter((one): one is string => typeof one === 'string' && names.has(nameOf(one)))
      : []
    if (paths.length) return paths
    await how.wait(APART)
  }
  return []
}
