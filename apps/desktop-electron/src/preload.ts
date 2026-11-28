import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { Script } from './wire'

function run(scripts: Script[]): void {
  for (const one of scripts)
    void webFrame.executeJavaScript(one.script).catch((error: unknown) => {
      console.error('an initialization script failed', error)
    })
}
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('ipc', {
    postMessage: (message: string) => {
      ipcRenderer.send('orden:post', message)
    },
  })
  const scripts = ipcRenderer.sendSync('orden:scripts') as Script[]
  if (document.documentElement as HTMLElement | null) run(scripts)
  else {
    const waiting = new MutationObserver(() => {
      if (!(document.documentElement as HTMLElement | null)) return
      waiting.disconnect()
      run(scripts)
    })
    waiting.observe(document, { childList: true })
  }
}
