import { app, ipcMain, Menu, nativeTheme, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Core } from './core'
import { PRIVILEGED, Requests } from './schemes'
import { cursor, Windows } from './windows'
import type { Frame } from './wire'

const IDENTIFIER = 'so.orden.Orden.Electron'
const NAME = 'Orden Electron'
const SPACES_DIR = 'ORDEN_SPACES_DIR'
let code: number | null = null
const core = new Core({
  identifier: IDENTIFIER,
  heard: (frame) => void heard(frame),
  silent: () => {
    windows.alone = true
    requests.drop()
    windows.destroyAll()
  },
  left: (ended) => {
    app.exit(code ?? ended)
  },
})
const windows = new Windows(core.send)
const requests = new Requests(core.send, (contents) => windows.pageOf(contents))
function program(): string {
  const named = process.env.ORDEN_ELECTRON_CORE
  if (named) return named
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const beside = join(process.resourcesPath, `orden-core${suffix}`)
  if (existsSync(beside)) return beside
  return join(__dirname, '..', '..', 'desktop', 'src-tauri', 'target', 'debug', `orden${suffix}`)
}
function localData(): string {
  if (process.platform === 'win32') return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  if (process.platform === 'darwin') return app.getPath('appData')
  const named = process.env.XDG_DATA_HOME
  return named && isAbsolute(named) ? named : join(homedir(), '.local', 'share')
}
function spaces(): string {
  const named = process.env[SPACES_DIR]
  return named && isAbsolute(named) ? named : join(localData(), IDENTIFIER, 'Spaces')
}
async function heard({ head, body }: Frame): Promise<void> {
  const reply = (id: number | null, value: unknown): void => {
    if (id != null) core.send({ op: 'reply', id, value: value ?? null })
  }
  const answered = async (id: number | null, asked: () => unknown): Promise<void> => {
    try {
      reply(id, await asked())
    } catch (error) {
      if (process.env.ORDEN_ELECTRON_TRACE) console.error('the shell could not do', head.op, error)
      reply(id, null)
    }
  }
  switch (head.op) {
    case 'hello':
      return
    case 'window-create':
      return answered(null, () => {
        windows.create(head)
      })
    case 'webview-create':
      return answered(null, () => {
        windows.attach(head)
      })
    case 'window-call':
      return answered(head.id, () => windows.windowCall(head))
    case 'webview-call':
      return answered(head.id, () => windows.webviewCall(head))
    case 'eval':
      return answered(head.id, () => windows.evaluate(head))
    case 'respond':
      requests.respond(head, body)
      return
    case 'refuse':
      requests.refuse(head.request)
      return
    case 'screen':
      return answered(head.id, () => windows.screens(head.screens))
    case 'cursor':
      return answered(head.id, cursor)
    case 'dark':
      return answered(head.id, () => nativeTheme.shouldUseDarkColors)
    case 'version':
      return answered(head.id, () => process.versions.chrome)
    case 'theme':
      nativeTheme.themeSource = head.theme === 'light' || head.theme === 'dark' ? head.theme : 'system'
      return
    case 'exit':
      code = head.code
      windows.alone = true
      windows.destroyAll()
      core.end()
  }
}
async function begin(): Promise<void> {
  app.on('window-all-closed', () => undefined)
  app.on('second-instance', () => {
    windows.front()
  })
  app.on('will-quit', (event) => {
    if (!core.running) return
    event.preventDefault()
    core.end()
  })
  process.on('exit', () => {
    core.kill()
  })
  process.on('uncaughtException', (error) => {
    console.error(error)
    core.kill()
    app.exit(1)
  })
  await app.whenReady()
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  )
  requests.serve()
  ipcMain.on('orden:scripts', (event) => {
    event.returnValue = event.senderFrame === event.sender.mainFrame ? windows.scriptsOf(event.sender.id) : []
  })
  ipcMain.on('orden:post', (event, message: unknown) => {
    const frame = event.senderFrame
    const webview = windows.pageOf(event.sender.id)
    if (typeof message !== 'string' || !frame || frame !== event.sender.mainFrame || webview === undefined) return
    core.send({ op: 'post', webview, url: frame.url }, Buffer.from(message))
  })
  core.start(program(), { ...process.env, [SPACES_DIR]: spaces() })
}
app.setName(NAME)
app.setPath('userData', join(app.getPath('appData'), IDENTIFIER, 'shell'))
protocol.registerSchemesAsPrivileged(PRIVILEGED)
if (app.requestSingleInstanceLock()) void begin()
else app.exit(0)
