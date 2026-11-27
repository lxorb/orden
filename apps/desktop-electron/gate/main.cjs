const { app, BrowserWindow, WebContentsView, ipcMain, session, screen, nativeImage } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const check = process.env.GATE_CHECK || 'manual'
const mode = process.env.GATE_MODE || 'webview'
const out = process.env.GATE_OUT || path.join(process.cwd(), 'out')
const assets = process.env.GATE_ASSETS || path.join(__dirname, '..', 'assets')
const phase = process.env.GATE_PHASE || '1'
const py = process.env.GATE_PY || 'python3'
const started = Number(process.env.GATE_STARTED || Date.now())
const bench = path.join(__dirname, 'bench')
const PARTITION = 'persist:gate'
fs.mkdirSync(out, { recursive: true })
if (process.env.GATE_USERDATA) app.setPath('userData', process.env.GATE_USERDATA)
app.commandLine.appendSwitch('force-device-scale-factor', '1')
if (process.env.GATE_A11Y) app.commandLine.appendSwitch('force-renderer-accessibility')
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const notes = []
const note = (s) => notes.push(s)
const osio = (...a) => execFileSync(py, [path.join(__dirname, 'osio.py'), ...a.map(String)], { encoding: 'utf8' })
const TYPES = { '.html': 'text/html', '.mp4': 'video/mp4', '.webm': 'video/webm', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }

function serve(root, fallback) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/login') {
      res.setHeader('set-cookie', 'gate=kept; Max-Age=31536000; Path=/; HttpOnly')
      return res.end('ok')
    }
    if (url.pathname === '/whoami') return res.end(req.headers.cookie || '')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) return res.writeHead(403).end()
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const inAssets = path.join(assets, path.basename(url.pathname))
      if (fs.existsSync(inAssets) && fs.statSync(inAssets).isFile()) file = inAssets
      else if (fallback) file = path.join(root, fallback)
      else return res.writeHead(404).end()
    }
    const size = fs.statSync(file).size
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream')
    res.setHeader('accept-ranges', 'bytes')
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    if (range) {
      const from = Number(range[1])
      const to = range[2] ? Number(range[2]) : size - 1
      res.writeHead(206, { 'content-range': `bytes ${from}-${to}/${size}`, 'content-length': to - from + 1 })
      return fs.createReadStream(file, { start: from, end: to }).pipe(res)
    }
    res.setHeader('content-length', size)
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((r) => server.listen(Number(process.env.GATE_PORT || 0), '127.0.0.1', () => r('http://127.0.0.1:' + server.address().port)))
}

const guests = []
const taken = []
const said = []
app.on('web-contents-created', (_, wc) => {
  if (wc.getType() === 'backgroundPage') {
    said.push('background page: ' + wc.getURL())
    wc.on('console-message', (event) => said.length < 40 && said.push(`${event.level}: ${String(event.message).slice(0, 200)}`))
    wc.on('did-finish-load', () => said.push('loaded ' + wc.getURL()))
  }
  if (wc.getType() !== 'webview') return
  guests.push(wc)
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'k') {
      taken.push('ctrl+k')
      event.preventDefault()
    }
  })
})

let win = null
let view = null
let base = ''
async function open(page, options = {}) {
  win = new BrowserWindow({ x: 0, y: 0, width: 1280, height: 800, frame: false, useContentSize: true, show: true, webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } })
  const url = page.startsWith('http') ? page : base + '/' + page
  let ready
  const isReady = new Promise((r) => (ready = r))
  if (mode === 'view') {
    view = new WebContentsView({ webPreferences: { partition: options.partition || undefined } })
    win.contentView.addChildView(view)
    ipcMain.on('bounds', (_, b) => view.setBounds(b))
    view.webContents.once('dom-ready', ready)
    view.webContents.loadURL(url)
  } else ipcMain.once('ready', ready)
  await win.loadFile(path.join(bench, 'host.html'), { query: { mode, url, partition: options.partition || '' } })
  await isReady
  win.focus()
  await sleep(options.settle ?? 1500)
}
const guest = () => (mode === 'view' ? view.webContents : guests[0])
const host = (s, ...a) => win.webContents.executeJavaScript(`window.steps.${s}(${a.map((x) => JSON.stringify(x)).join(',')})`)
const page = (code) => guest().executeJavaScript(code, true)
const at = (x, y) => {
  const b = win.getContentBounds()
  return [b.x + x, b.y + y]
}
const inPane = (x, y) => at(200 + x, 50 + y)

function filming() {
  const frames = []
  win.webContents.beginFrameSubscription(false, (image) => {
    const size = image.getSize()
    frames.push({ t: Date.now(), w: size.width, h: size.height, data: image.toBitmap() })
  })
  return {
    frames,
    stop: () => win.webContents.endFrameSubscription(),
  }
}
const px = (f, x, y) => {
  const o = (y * f.w + x) * 4
  return [f.data[o + 2], f.data[o + 1], f.data[o]]
}
const kind = ([r, g, b]) => {
  if (r > 200 && g > 200 && b < 80) return 'Y'
  if (r < 80 && g < 80 && b > 200) return 'B'
  if (r > 200 && g < 80 && b < 80) return 'R'
  if (r > 200 && g < 80 && b > 200) return 'M'
  if (r < 80 && g > 150 && b < 80) return 'G'
  return '.'
}
const rowOf = (f, y) => {
  let s = ''
  for (let x = 0; x < f.w; x++) s += kind(px(f, x, y))
  return s
}
function motionOf(rows) {
  let moving = 0
  let wrong = 0
  let worst = 0
  let prev = null
  for (const row of rows) {
    const xm = row.indexOf('Y')
    if (xm < 0) continue
    if (prev !== null && xm !== prev) {
      moving++
      const xb = row.lastIndexOf('B', xm)
      const red = row.slice(200, xm).split('R').length - 1
      const e = Math.max(xb < 0 ? 6 : Math.abs(xm - (xb + 1)), red)
      if (e > 1) {
        wrong++
        worst = Math.max(worst, e)
      }
    }
    prev = xm
  }
  return { moving, wrong, worst }
}
const pace = (t) => {
  const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b)
  return { fps: Math.round((1000 * d.length) / (t[t.length - 1] - t[0])), p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) }
}
function screenShot(name) {
  const file = path.join(out, `${check}-${name}.png`)
  try {
    const got = JSON.parse(osio('grab', file))
    const image = nativeImage.createFromPath(file)
    const scale = got.width / screen.getPrimaryDisplay().size.width
    const data = image.toBitmap()
    const b = win.getContentBounds()
    return { w: got.width, h: got.height, data, scale, at: (x, y) => px({ w: got.width, data }, Math.round((b.x + x) * scale), Math.round((b.y + y) * scale)) }
  } catch (error) {
    note(`screen capture failed (${name}): ${String(error).slice(0, 200)}`)
    return null
  }
}
function cpu() {
  app.getAppMetrics()
  return () => {
    const m = app.getAppMetrics()
    return { cpu: +m.reduce((s, p) => s + p.cpu.percentCPUUsage, 0).toFixed(1), byType: Object.fromEntries(['Browser', 'GPU', 'Tab', 'Utility'].map((t) => [t, +m.filter((p) => p.type === t).reduce((s, p) => s + p.cpu.percentCPUUsage, 0).toFixed(1)])) }
  }
}
const memory = () => {
  const m = app.getAppMetrics()
  return { processes: m.length, workingSetMB: Math.round(m.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024), privateMB: Math.round(m.reduce((s, p) => s + (p.memory.privateBytes || 0), 0) / 1024) }
}

const checks = {
  async resize() {
    await open('page.html')
    const film = filming()
    await sleep(300)
    const end = cpu()
    const times = await host('motion')
    const used = end()
    await sleep(300)
    film.stop()
    const seen = motionOf(film.frames.map((f) => rowOf(f, 300)))
    const result = { frames: film.frames.length, ...seen, pace: pace(times), ...used }
    if (mode === 'view') return { pass: true, data: { pace: result.pace, cpu: result.cpu, note: 'the native view is not part of the window frame, so only pace is compared' } }
    return { pass: seen.moving >= 100 && seen.wrong === 0, data: result }
  },
  async layers() {
    await open('page.html')
    const data = {}
    const near = (c, want, tol = 40) => c.every((v, i) => Math.abs(v - want[i]) <= tol)
    const grab = async (name, on) => {
      const film = filming()
      await host(name, on)
      await sleep(600)
      film.stop()
      return { film, shot: screenShot(name) }
    }
    const rest = filming()
    await sleep(300)
    rest.stop()
    const r = rest.frames.at(-1)
    data.rest = { page: px(r, 500, 300), edge: px(r, 797, 300), mark: px(r, 803, 300) }
    const menu = await grab('menu', true)
    const firstWith = menu.film.frames.find((f) => rowOf(f, 350).includes('M'))
    const m = menu.film.frames.at(-1)
    data.menu = { firstFrameWidth: firstWith ? rowOf(firstWith, 350).split('M').length - 1 : 0, centre: px(m, 400, 350), shadow: px(m, 290, 350), far: px(m, 600, 350), screen: menu.shot && { centre: menu.shot.at(400, 350), shadow: menu.shot.at(290, 350) } }
    await host('menu', false)
    const scrim = await grab('scrim', true)
    const s = scrim.film.frames.at(-1)
    data.scrim = { page: px(s, 500, 300), edgeBlend: px(s, 796, 300), screen: scrim.shot && { page: scrim.shot.at(500, 300), edgeBlend: scrim.shot.at(796, 300) } }
    await host('scrim', false)
    const shape = await grab('shape', true)
    const h = shape.film.frames.at(-1)
    data.shape = { centre: px(h, 500, 350), corner: px(h, 352, 202), outside: px(h, 700, 350), inside: px(h, 400, 350), screen: shape.shot && { centre: shape.shot.at(500, 350), corner: shape.shot.at(352, 202), outside: shape.shot.at(700, 350) } }
    await host('shape', false)
    const bg = [32, 32, 32]
    const green = (c) => c[1] > c[0] + 30 && c[1] > c[2] + 30
    const ok = {
      rest: kind(data.rest.page) === 'G' && kind(data.rest.edge) === 'B' && kind(data.rest.mark) === 'Y',
      menuWhole: data.menu.firstFrameWidth === 200 && kind(data.menu.centre) === 'M',
      menuShadow: green(data.menu.shadow) && data.menu.shadow[1] < data.menu.far[1] - 30,
      scrim: green(data.scrim.page) && data.scrim.page[1] < 170 && kind(data.scrim.edgeBlend) !== 'B' && kind(data.scrim.edgeBlend) !== 'G',
      shape: green(data.shape.centre) && data.shape.centre[1] < 180 && near(data.shape.corner, bg) && near(data.shape.outside, bg) && green(data.shape.inside),
    }
    if (menu.shot) ok.screenMenu = kind(data.menu.screen.centre) === 'M' && green(data.menu.screen.shadow)
    if (shape.shot) ok.screenShape = green(data.shape.screen.centre) && near(data.shape.screen.corner, bg) && near(data.shape.screen.outside, bg)
    if (scrim.shot) ok.screenScrim = green(data.scrim.screen.page) && data.scrim.screen.page[1] < 170
    return { pass: Object.values(ok).every(Boolean), data: { ok, ...data } }
  },
  async keys() {
    await open('page.html')
    const data = {}
    osio('click', ...inPane(100, 35))
    await sleep(400)
    osio('type', 'ab')
    await sleep(400)
    data.typed = (await page('state()')).in
    data.hostHeardWhileTyping = (await host('state')).heard.length
    osio('key', 'ctrl+k')
    await sleep(400)
    data.appTook = [...taken]
    data.pageSawK = (await page('state()')).keys.includes('k')
    osio('key', 'Tab')
    await sleep(300)
    data.afterTab = (await page('state()')).active
    osio('key', 'Tab')
    await sleep(300)
    const left = await host('state')
    data.afterLeaving = { hostActive: left.active, hostFocus: left.focus, pageFocus: (await page('state()')).focus }
    osio('key', 'shift+Tab')
    await sleep(300)
    const backIn = await page('state()')
    data.shiftTabBack = { pageFocus: backIn.focus, pageActive: backIn.active }
    osio('click', ...at(60, 25))
    await sleep(300)
    osio('type', 'x')
    await sleep(300)
    const back = await host('state')
    data.hostTyped = back.hostin
    data.hostActive = back.active
    data.pageFocusAfterHostClick = (await page('state()')).focus
    for (let i = 0; i < 3 && (await page('state()')).focus === false; i++) {
      osio('key', 'Tab')
      await sleep(300)
    }
    const entered = await page('state()')
    data.tabInto = { pageFocus: entered.focus, pageActive: entered.active, hostActive: (await host('state')).active }
    const ok = {
      typed: data.typed === 'ab',
      hostQuiet: data.hostHeardWhileTyping === 0,
      shortcut: data.appTook.includes('ctrl+k') && !data.pageSawK,
      tabInside: data.afterTab === 'in2',
      tabOut: data.afterLeaving.hostActive === 'hostafter' && data.afterLeaving.pageFocus === false,
      shiftTabBack: data.shiftTabBack.pageFocus === true && data.shiftTabBack.pageActive === 'in2',
      hostTyped: data.hostTyped === 'x' && data.pageFocusAfterHostClick === false,
      tabInto: data.tabInto.pageFocus === true && data.tabInto.hostActive === 'WEBVIEW',
    }
    return { pass: Object.values(ok).every(Boolean), data: { ok, ...data } }
  },
  async ime() {
    await open('page.html')
    osio('click', ...inPane(100, 35))
    await sleep(400)
    const dbg = guest().debugger
    dbg.attach('1.3')
    await dbg.sendCommand('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 })
    await dbg.sendCommand('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 })
    const during = await page('state()')
    await dbg.sendCommand('Input.insertText', { text: '日本' })
    await sleep(200)
    const after = await page('state()')
    dbg.detach()
    const ok = { composing: during.in === 'にほん' && during.comp.some((c) => c.startsWith('compositionupdate')), committed: after.in === '日本' && after.comp.some((c) => c.startsWith('compositionend')) }
    return { pass: Object.values(ok).every(Boolean), data: { ok, during: during.in, after: after.in, events: after.comp, level: 'Chromium composition path through CDP, not the operating system input method' } }
  },
  async dnd() {
    await open('page.html')
    const data = {}
    osio('drag', ...at(60, 120), ...inPane(100, 210))
    await sleep(600)
    data.hostToPage = (await page('state()')).drops
    osio('drag', ...inPane(100, 140), ...at(60, 240))
    await sleep(600)
    data.pageToHost = (await host('state')).drops
    data.seen = { host: await win.webContents.executeJavaScript('window.dragLog'), page: await page('window.dragLog') }
    const dbg = guest().debugger
    try {
      dbg.attach('1.3')
      const file = path.join(out, 'dropped.txt')
      fs.writeFileSync(file, 'gate')
      const drag = { items: [], files: [file], dragOperationsMask: 1 }
      for (const type of ['dragEnter', 'dragOver', 'drop']) await dbg.sendCommand('Input.dispatchDragEvent', { type, x: 100, y: 210, data: drag })
      await sleep(300)
      data.fileIntoPage = (await page('state()')).drops.filter((d) => d.files.length)
      dbg.detach()
    } catch (error) {
      data.fileError = String(error)
    }
    const ok = { hostToPage: data.hostToPage.some((d) => d.text === 'HOSTDRAG'), pageToHost: data.pageToHost.includes('PAGEDRAG'), fileIntoPage: (data.fileIntoPage || []).length > 0 }
    return { pass: Object.values(ok).every(Boolean), data: { ok, ...data, level: 'text drags by real pointer input, the file drop through CDP' } }
  },
  async video() {
    await open('video.html')
    const data = { can: await page('window.can'), widevine: await page('window.widevine()') }
    for (const file of ['video.mp4', 'video.webm']) {
      if (!fs.existsSync(path.join(assets, file))) {
        data[file] = 'no asset'
        continue
      }
      await page(`window.play(${JSON.stringify('/' + file)},2)`)
      const end = cpu()
      const played = await page(`window.play(${JSON.stringify('/' + file)},10)`)
      data[file] = { ...played, ...end() }
    }
    if (mode === 'webview') {
      const film = filming()
      await sleep(500)
      film.stop()
      const f = film.frames.at(-1)
      const c = px(f, 500, 350)
      data.pixels = c
      data.drawn = c[0] + c[1] + c[2] > 60
    }
    const one = data['video.mp4']
    const pass = typeof one === 'object' && one.total > 300 && one.dropped / one.total < 0.1 && (mode === 'view' || data.drawn)
    return { pass, data }
  },
  async scroll() {
    await open('heavy.html')
    const end = cpu()
    const fps = page('window.fps()')
    const target = guest()
    const [px0, py0] = [300, 300]
    const until = Date.now() + 5000
    while (Date.now() < until) {
      target.sendInputEvent({ type: 'mouseWheel', x: px0, y: py0, deltaX: 0, deltaY: -60, canScroll: true })
      await sleep(16)
    }
    const t = (await fps).slice(1).sort((a, b) => a - b)
    const used = end()
    const scrolled = await page('scrollY')
    const data = { scrolled, frames: t.length, fps: Math.round(t.length / 5), p50: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), ...used }
    return { pass: scrolled > 1000, data }
  },
  async idle() {
    await open('heavy.html')
    await sleep(3000)
    const end = cpu()
    await sleep(15000)
    return { pass: true, data: { ...end(), ...memory() } }
  },
  async memory() {
    await open('heavy.html', { partition: PARTITION })
    await sleep(3000)
    const data = { one: memory() }
    if (mode === 'webview') {
      await host('tabs', 7, base + '/heavy.html')
    } else {
      const made = []
      for (let i = 0; i < 7; i++) {
        const v = new WebContentsView({ webPreferences: { partition: PARTITION } })
        win.contentView.addChildView(v)
        v.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        made.push(new Promise((r) => v.webContents.once('did-finish-load', r)))
        v.webContents.loadURL(base + '/heavy.html?n=' + i)
      }
      await Promise.all(made)
    }
    await sleep(6000)
    data.eight = memory()
    return { pass: true, data }
  },
  async persist() {
    const other = session.fromPartition('persist:other')
    if (phase === '1') {
      await open('login.html', { partition: PARTITION })
      await page('signIn()')
      const now = await page('who()')
      const ses = session.fromPartition(PARTITION)
      await ses.cookies.flushStore()
      ses.flushStorageData()
      await sleep(1500)
      return { pass: now.cookie.includes('gate=kept'), data: { signedIn: now } }
    }
    await open('login.html', { partition: PARTITION })
    const kept = await page('who()')
    const elsewhere = await other.cookies.get({ name: 'gate' })
    const ok = { cookie: kept.cookie.includes('gate=kept'), local: kept.local === 'kept', idb: kept.idb === 'kept', otherProfileApart: elsewhere.length === 0 }
    return { pass: Object.values(ok).every(Boolean), data: { ok, afterRestart: kept } }
  },
  async ext() {
    const data = {}
    const ses = session.fromPartition(PARTITION)
    await open('ads.html', { partition: PARTITION })
    data.bare = await page('probe()')
    data.sameSession = guest().session === ses
    ses.webRequest.onBeforeRequest({ urls: ['*://pagead2.googlesyndication.com/*', '*://www.googletagmanager.com/*'] }, (details, done) => done({ cancel: true }))
    data.rawCancel = { seen: await page('probe()') }
    ses.webRequest.onBeforeRequest(null)
    ses.serviceWorkers.on('console-message', (_, m) => said.length < 40 && said.push(`worker ${m.level}: ${String(m.message).slice(0, 200)}`))
    ses.serviceWorkers.on('running-status-changed', (d) => said.push(`worker ${d.versionId} ${d.runningStatus}`))
    const tryExtension = async (name) => {
      const dir = path.join(assets, name)
      if (!fs.existsSync(dir)) return { skipped: 'no asset' }
      try {
        const api = ses.extensions || ses
        const loaded = await api.loadExtension(dir, { allowFileAccess: true })
        await sleep(name === 'ubo' ? 25000 : 8000)
        guest().reloadIgnoringCache()
        await sleep(3000)
        const seen = await page('probe()')
        api.removeExtension(loaded.id)
        await sleep(500)
        return { name: loaded.name, version: loaded.version, manifest: loaded.manifest.manifest_version, seen, cosmeticHidden: seen.cosmetic === 'none' }
      } catch (error) {
        return { error: String(error).slice(0, 300) }
      }
    }
    data.ubo = await tryExtension('ubo')
    data.uboLite = await tryExtension('ubol')
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron')
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
      blocker.enableBlockingInSession(ses)
      guest().reloadIgnoringCache()
      await sleep(3000)
      data.ownBlocker = { seen: await page('probe()') }
      blocker.disableBlockingInSession(ses)
    } catch (error) {
      data.ownBlocker = { error: String(error).slice(0, 300) }
    }
    try {
      const { ElectronChromeExtensions } = require('electron-chrome-extensions')
      const tabs = new ElectronChromeExtensions({ license: 'GPL-3.0', session: ses })
      tabs.addTab(guest(), win)
      tabs.selectTab(guest())
      data.uboWithTabs = await tryExtension('ubo')
      data.uboLiteWithTabs = await tryExtension('ubol')
    } catch (error) {
      data.uboWithTabs = { error: String(error).slice(0, 300) }
    }
    data.background = said
    const blocks = (r) => !!r && !!r.seen && r.seen.ads !== 'loaded' && r.seen.tracker !== 'loaded' && r.seen.control === 'loaded'
    const network = data.bare.ads === 'loaded' && data.bare.control === 'loaded'
    const ok = { network, rawCancel: blocks(data.rawCancel), ubo: blocks(data.ubo), uboLite: blocks(data.uboLite), uboWithTabs: blocks(data.uboWithTabs), uboLiteWithTabs: blocks(data.uboLiteWithTabs), ownBlocker: blocks(data.ownBlocker) }
    return { pass: network && (ok.ubo || ok.uboLite || ok.ownBlocker || ok.rawCancel), data: { ok, ...data } }
  },
  async startup() {
    const ready = Date.now()
    win = new BrowserWindow({ x: 0, y: 0, width: 1280, height: 800, show: true, webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } })
    const loaded = new Promise((r) => win.webContents.once('did-finish-load', () => r(Date.now())))
    const gotGuest = new Promise((r) => ipcMain.once('ready', () => r(Date.now())))
    win.loadFile(path.join(bench, 'host.html'), { query: { mode: 'webview', url: base + '/page.html' } })
    const t = { toReady: ready - started, toHostLoaded: (await loaded) - started, toGuestReady: (await gotGuest) - started }
    await sleep(300)
    return { pass: true, data: { ...t, ...memory() } }
  },
  async manual() {
    win = new BrowserWindow({ width: 1280, height: 800, webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } })
    await win.loadFile(path.join(bench, 'host.html'), { query: { mode: 'webview', url: process.env.GATE_URL || base + '/page.html', partition: PARTITION } })
    await new Promise(() => undefined)
  },
}

app.whenReady().then(async () => {
  base = await serve(bench)
  let result
  try {
    result = await Promise.race([checks[check](), sleep(Number(process.env.GATE_TIMEOUT || 220000)).then(() => ({ pass: false, data: { error: 'timed out' } }))])
  } catch (error) {
    result = { pass: false, data: { error: String((error && error.stack) || error).slice(0, 1500) } }
  }
  const gpu = app.getGPUFeatureStatus()
  const body = { check, mode, phase, platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, gpu: { compositing: gpu.gpu_compositing, video: gpu.video_decode, raster: gpu.rasterization }, ...result, notes }
  fs.writeFileSync(path.join(out, `${check}-${mode}${phase === '1' ? '' : '-' + phase}.json`), JSON.stringify(body, null, 1))
  app.exit(0)
})
