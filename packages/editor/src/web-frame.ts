const SANDBOX = new Set([
  'allow-scripts',
  'allow-same-origin',
  'allow-presentation',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
])

export const FRAME_REFERRER = 'origin'

const ALLOW = new Set([
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
])

export function framedPage(
  address: string,
  own: string | undefined = typeof location === 'undefined' ? undefined : location.origin,
): string | null {
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' || url.origin === own) return null
    return url.toString()
  } catch {
    return null
  }
}

function allowed(written: string | undefined, list: ReadonlySet<string>, between: string): string {
  return (written ?? '')
    .split(/[\s;]+/)
    .filter((one) => list.has(one))
    .join(between)
}

export function frameSandbox(written: string | undefined): string {
  return allowed(written, SANDBOX, ' ')
}

function known(frame: HTMLIFrameElement, sandbox: string): string {
  try {
    return sandbox
      .split(' ')
      .filter((one) => frame.sandbox.supports(one))
      .join(' ')
  } catch {
    return sandbox
  }
}

export function framePermissions(written: string | undefined): string {
  return allowed(written, ALLOW, '; ')
}

function pageFrame(card: HTMLElement, title: string): HTMLIFrameElement | null {
  const source = framedPage(card.dataset.frame ?? '')
  if (source === null) return null

  const frame = document.createElement('iframe')
  frame.className = 'embed-frame'
  frame.setAttribute('sandbox', known(frame, frameSandbox(card.dataset.sandbox)))
  const permissions = framePermissions(card.dataset.allow)
  if (permissions) frame.setAttribute('allow', permissions)
  frame.referrerPolicy = FRAME_REFERRER
  frame.loading = 'lazy'
  frame.title = title
  frame.src = source

  return frame
}

const SIZED = 'orden-html-frame'

const LEAST_HEIGHT = 40
const MOST_HEIGHT = 2400

export function frameHeight(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null

  const message = data as Record<string, unknown>
  if (message.nib !== SIZED) return null

  const asked = message.height
  if (typeof asked !== 'number' || !Number.isFinite(asked)) return null

  return Math.min(MOST_HEIGHT, Math.max(LEAST_HEIGHT, Math.ceil(asked)))
}

const REPORT = `(function(){
var post=function(){parent.postMessage({nib:'${SIZED}',height:document.body.scrollHeight},'*')}
if(window.ResizeObserver){new ResizeObserver(post).observe(document.body)}
addEventListener('load',post)
post()
})()`

export function literal(text: string): string {
  return JSON.stringify(text).replace(/</g, '\\u003c')
}

export function frameDocument(parts: {
  head: string
  block?: string
  program: string
  script: string
}): string {
  const block =
    parts.block === undefined
      ? ''
      : `<script type="application/json" id="orden-block">${literal(parts.block)}</script>\n`

  return `<!doctype html>
<meta charset="utf-8">
${parts.head}
<body>
${block}<script type="text/plain" id="orden-frame">${parts.program}</script>
<script>${parts.script}</script>
`
}

export function htmlFrameDocument(html: string, script: string): string {
  return frameDocument({
    head: `<title>html</title>
<style>html,body{margin:0;padding:0;background:transparent;color-scheme:light dark}</style>`,
    block: html,
    program: REPORT,
    script,
  })
}

async function ownFrame(html: string, title: string): Promise<HTMLIFrameElement | null> {
  const [{ FRAME_SCRIPT: script }, { guardedBlock }] = await Promise.all([
    import('./frame-text'),
    import('./loop-guard'),
  ])
  if (script === null) return null

  const frame = document.createElement('iframe')
  frame.className = 'embed-frame'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.title = title
  frame.srcdoc = htmlFrameDocument(guardedBlock(html), script)

  return frame
}

const sizing = new Map<MessageEventSource, HTMLElement>()

let listening = false

function sized(event: MessageEvent) {
  for (const [where, card] of sizing) {
    if (!card.isConnected) sizing.delete(where)
  }

  const card = event.source === null ? undefined : sizing.get(event.source)
  if (card === undefined) return

  const height = frameHeight(event.data)
  if (height !== null) card.style.setProperty('--embed-height', `${height}px`)
}

function sizeWith(card: HTMLElement, frame: HTMLIFrameElement) {
  const where = frame.contentWindow
  if (where === null) return

  if (!listening) {
    listening = true
    window.addEventListener('message', sized)
  }
  sizing.set(where, card)
}

export function loadEmbed(card: HTMLElement): boolean {
  if (card.dataset.loaded !== undefined) return false

  const said = card.textContent.trim()
  const title = said || (card.dataset.provider ?? 'embed')

  const own = card.dataset.srcdoc
  if (own !== undefined) {
    card.dataset.loaded = ''
    void ownFrame(own, title).then((frame) => {
      if (frame === null) {
        delete card.dataset.loaded
        return
      }
      card.textContent = ''
      card.append(frame)
      sizeWith(card, frame)
    })
    return true
  }

  const frame = pageFrame(card, title)
  if (frame === null) return false

  card.textContent = ''
  card.dataset.loaded = ''
  card.append(frame)

  return true
}

export function embedClicks(root: HTMLElement): () => void {
  const clicked = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const card = target.closest('.embed-web')
    if (!(card instanceof HTMLElement)) return

    if (loadEmbed(card)) event.preventDefault()
  }

  root.addEventListener('click', clicked)
  return () => root.removeEventListener('click', clicked)
}
