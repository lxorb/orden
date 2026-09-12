/** What a frame in a web tab is allowed, and why a browser build asks before it
 *  makes one.
 *
 *  A page in a browser can only be shown in a frame, and a great deal of the web
 *  refuses to be framed: `X-Frame-Options: DENY` and CSP's `frame-ancestors` are a
 *  header the site sends and the browser obeys. Nothing on this side can talk it
 *  round, and - this is the part that decides the design - **nothing on this side
 *  can find out either.**
 *
 *  That was measured rather than assumed. A frame pointed at another origin reports
 *  exactly the same thing whether the page arrived or was refused: `load` fires for
 *  both, reading its location throws `SecurityError` for both, its document is null
 *  for both, `length` is 0 for both, and the resource entry in the parent's timeline
 *  is opaque for both - status 0, size 0. Only a page on this app's own origin reads
 *  back, and no site is on this app's own origin. The four cases are written out side
 *  by side in docs/web-tabs.md.
 *
 *  So there are two honest designs: frame every page and leave whoever hit a refusal
 *  looking at the browser's own grey apology, or ask first. This asks first, with the
 *  same gesture the app already uses for a page embedded in a note: a card that says
 *  what it stands for, and a press that swaps the frame in. One press per tab, not
 *  per page - once the reader has said yes, the frame stays. See web-embed.ts in
 *  @nib/markdown and web-frame.ts in @nib/editor, which are that pattern, and
 *  docs/web-tabs.md for the decision.
 *
 *  A `HEAD` through the app's own Worker would answer it reliably, and is written
 *  down as the way to get rid of the press. It was not taken here: it makes the
 *  app's server a fetcher of arbitrary addresses on a reader's behalf, and it is a
 *  round trip before a page a reader has already chosen. */

/** What a frame in a web tab may do.
 *
 *  Scripts, because a page without them is not the page. Its own origin, because
 *  without it a site gets an opaque one and loses its cookies, its storage and any
 *  chance of showing somebody their own account - and because the frame is always
 *  cross-origin here, where `allow-same-origin` grants the frame its own origin and
 *  never this one. Forms and popups, because a page that cannot be used is not worth
 *  framing. Not top navigation: a page must not be able to move the window the app
 *  is in. The same tokens the editor's embed frames are allowed; see web-frame.ts. */
export const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

/** What a framed page is permitted, which is nothing.
 *
 *  A site in a tab is somebody else's code, and the camera, the microphone and where
 *  you are stay refused until somebody says otherwise - the same answer the desktop
 *  gives by taking the APIs away; see permissions.svelte.ts. An `allow` that names
 *  nothing is a frame that may ask for nothing. */
export const ALLOW = ''
