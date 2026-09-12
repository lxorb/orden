/** Whether a browser build may show a page at all, and what a frame is allowed to
 *  do while it does.
 *
 *  A page in a browser can only be shown in a frame, and most of the web refuses to
 *  be framed: `X-Frame-Options: DENY` and CSP's `frame-ancestors` are a header the
 *  site sends and the browser obeys, and nothing on this side can talk it round. The
 *  honest thing is to find out and say so, which is what the card is for.
 *
 *  Finding out without a server. The headers cannot be read from here - a
 *  cross-origin `HEAD` needs the site's permission, which is what CORS is - so the
 *  answer is read off the frame itself. A page that framed is cross-origin and its
 *  location cannot be touched; a page that was refused leaves the frame on
 *  `about:blank`, which is this origin's and reads back without throwing. That is the
 *  whole of the test. A `HEAD` through the Worker would be a second answer to the
 *  same question and would make the app's own server a fetcher of arbitrary
 *  addresses; see docs/web-tabs.md.
 *
 *  The sandbox is the one the app already grants an embedded page, for the reasons
 *  stated there: see web-frame.ts in @nib/editor. Nothing here grants more. */

/** How long a page has to arrive before the card stands in for it.
 *
 *  A site that is being slow and a site that will never answer look the same from
 *  here, and after eight seconds the difference has stopped mattering to whoever is
 *  waiting. */
export const PATIENCE = 8_000

/** What a frame in a web tab may do.
 *
 *  Scripts, because a page without them is not the page. Its own origin, because
 *  without it a site gets an opaque one and loses its cookies, its storage and any
 *  chance of showing somebody their own account - and because the frame is always
 *  cross-origin here, where `allow-same-origin` grants the frame its own origin and
 *  never this one. Forms and popups, because a page that cannot be used is not worth
 *  framing. Not top navigation: a page must not be able to move the window the app
 *  is in. */
export const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

/** What a framed page is permitted, which is nothing.
 *
 *  A site in a tab is somebody else's code, and the camera, the microphone and where
 *  you are stay refused until somebody says otherwise - the same answer the desktop
 *  gives by taking the APIs away; see permissions.svelte.ts. An `allow` that names
 *  nothing is a frame that may ask for nothing. */
export const ALLOW = ''

/** Whether the address a frame came back with is the page or the browser's refusal
 *  to show it.
 *
 *  Nothing at all, or still the blank page a frame starts on: the navigation never
 *  happened, which is what a refusal looks like from here. An address that reads back
 *  at all is this origin's, because a cross-origin page cannot be read - which is why
 *  a page that really loaded throws instead of answering. */
export function refusedAt(at: string | null | undefined): boolean {
  return at === undefined || at === null || at === '' || at === 'about:blank'
}

/** The same question of a frame that has finished loading. Only worth asking then:
 *  before that every frame is on `about:blank` and every answer is "refused". */
export function refused(frame: HTMLIFrameElement): boolean {
  try {
    return refusedAt(frame.contentWindow?.location.href)
  } catch {
    // Reading across an origin threw, which only a page that really loaded can do.
    return false
  }
}
