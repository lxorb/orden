/** Turning the card a web embed renders as into the frame it stands for, when the
 *  reader asks for it.
 *
 *  One place, because three surfaces show the same card: the editor's live
 *  preview, the reading view, and a canvas card. The markup comes from
 *  @nib/markdown, which knows the provider, the sandbox it needs and the
 *  permissions it is granted; this only builds the element from what the card
 *  already says. Nothing here decides policy - a surface that could loosen a
 *  sandbox would be a surface where the policy is not the policy.
 *
 *  A published page has none of this and does not want it: there the card is a
 *  link, and a click goes to the page itself. */

/** The sandbox tokens a card is allowed to ask for. A card comes from the
 *  renderer, but a note can be pasted, synced or shared, and one that arrived
 *  with `allow-top-navigation` written into it would be a note that can move the
 *  window the app is in. So the card says what it wants and this says what it may
 *  have; `allow-same-origin` is on the list because with a cross-origin frame it
 *  grants the frame its own origin, never this one. */
const SANDBOX = new Set([
  'allow-scripts',
  'allow-same-origin',
  'allow-presentation',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
])

/** What a frame tells the provider about where it was asked from: the origin, and
 *  never the page.
 *
 *  `no-referrer` was the first answer here, and it does not work. YouTube refuses
 *  to play to an embedder that sends none and puts "Error 153" where the video
 *  should be, which is worse than the link the card replaced. The origin is what a
 *  provider learns from the request in any case - which site, never which note -
 *  and saying it out loud beats leaving it to whatever the page defaults to. */
export const FRAME_REFERRER = 'origin'

/** The permissions a card may be granted, for the same reason. */
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

/** Only over https, and only what a browser will frame. A card written by hand
 *  with a `javascript:` frame in it is a card that gets no frame. */
export function framedPage(address: string): string | null {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' ? url.toString() : null
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

/** The sandbox a card may actually have, whatever it asked for. */
export function frameSandbox(written: string | undefined): string {
  return allowed(written, SANDBOX, ' ')
}

/** The permissions a card may actually be granted, whatever it asked for. */
export function framePermissions(written: string | undefined): string {
  return allowed(written, ALLOW, '; ')
}

/** The frame a card stands for, or null when the card does not name one this may
 *  load. */
function frameOf(card: HTMLElement): HTMLIFrameElement | null {
  const source = framedPage(card.dataset.frame ?? '')
  if (source === null) return null

  const frame = document.createElement('iframe')
  frame.className = 'embed-frame'
  frame.setAttribute('sandbox', frameSandbox(card.dataset.sandbox))
  const permissions = framePermissions(card.dataset.allow)
  if (permissions) frame.setAttribute('allow', permissions)
  frame.referrerPolicy = FRAME_REFERRER
  frame.loading = 'lazy'
  frame.title = card.dataset.provider ?? 'embed'
  frame.src = source

  return frame
}

/** Puts the frame where the card was. Returns whether it did: a card already
 *  loaded, or one naming nothing loadable, is left alone. */
export function loadEmbed(card: HTMLElement): boolean {
  if (card.dataset.loaded !== undefined) return false

  const frame = frameOf(card)
  if (frame === null) return false

  card.textContent = ''
  card.dataset.loaded = ''
  card.append(frame)

  return true
}

/** Listens for a click on any card inside `root` and loads that one. Returns what
 *  undoes it, so a surface can give the listener back. */
export function embedClicks(root: HTMLElement): () => void {
  const clicked = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const card = target.closest('.embed-web')
    if (!(card instanceof HTMLElement)) return

    // The card is a link, and its href is where a page with no script sends the
    // reader. Here there is a script, so the frame arrives in place instead.
    if (loadEmbed(card)) event.preventDefault()
  }

  root.addEventListener('click', clicked)
  return () => root.removeEventListener('click', clicked)
}
