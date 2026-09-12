# Web tabs

A tab can be a website. The page is rendered by the system's own browser engine,
it has a bar with back, forward, reload and an address, and the site it shows is a
document in the space like a note or a canvas: a row in the file list with a globe
in front of it, a name somebody can rename, a bookmark, a `[[link]]`, a hit in the
search, a file the sync carries.

Emil, 2026-09-10: *"a tab can be a website rendered by Chromium, a URL bar,
back/forward, and a NOTE TYPE for it so a website is a document in the space."*

Chromium is half right, and the half that is wrong matters enough to say in the
first paragraph: on Windows the engine is WebView2, which **is** Chromium; on
macOS it is WKWebView, which is **WebKit** and is what Safari is built on; on
Linux it is WebKitGTK. nib does not ship a browser engine and never will - a
second Chromium is 150 MB and its own update channel - so a web tab is the
system's engine, and a page that behaves differently on a Mac is behaving the way
Safari behaves.

## The file

**A website in the space is a note whose front matter says `url:`.** Not a `.web`
file of its own.

```markdown
---
url: https://svelte.dev/docs
title: Svelte docs
date: 2026-09-12T08:30:00.000Z
---

# Svelte docs

<https://svelte.dev/docs>
```

The decision was between that and `Svelte docs.web` holding the same two lines as
YAML, and Obsidian settles it. A vault shows the extensions Obsidian knows and
hides every other one unless somebody has found "Detect all file extensions" in
the settings and turned it on. So a `.web` file would be **invisible** in the same
vault opened next door, unopenable there, outside its search, and absent from its
graph - a document in nib's space that is not a document in the vault the space
is. Everything else follows from the same fact:

| | `Name.web` | `Name.md` with `url:` |
| --- | --- | --- |
| in Obsidian | hidden by default, and "unsupported" when shown | a note, which opens and reads |
| `[[Name]]` | needs the extension, like `[[Board.canvas]]` | resolves, with no extension in the link |
| searched by title and address | only by nib, which would have to index a new kind of file | by anybody: the words are in the file |
| in the graph, the backlinks, the tags | a new kind for six readers to learn | already a note |
| synced, versioned, put in the trash and back | a new extension in `tree.rs`, in the sync's file list and in the link grammar | nothing to change |
| a mark in the file list | from the name | from the file, through the link index |

Only the last row costs anything. A name cannot say a note is a website, so the
kind is read out of the front matter - by the same pass over the space that
already reads `icon:`, `icon-color:` and `aliases:` off every note, and out of the
same map every row already asks for its chosen icon. No list reads a file twice
and nothing new walks the disk. See `apps/desktop/src/lib/web-tab/note.ts`,
`links.rs`, `scan-note.ts` and `FileMark.svelte`.

**The file is written the moment the page says what it is called.** A website in a
space keeps itself, exactly as a note in a space does: there is no Save, and the
file is named after the title the way every note this app writes is. Until the
page has answered there is a tab and no file, because a website nobody has chosen
yet has no name to be written under, and a folder of `Untitled` is what asking for
the name first would leave behind.

**Following a link inside the page does not rewrite the file.** The file says
where the document points; where the reader has got to is the tab's, kept in the
session so a restart comes back on the page they were reading. A file that moved
under every click would be a file no link could point at.

## The tab, per platform

| | what draws the page | why |
| --- | --- | --- |
| Windows | a child webview: WebView2, Chromium | the only embedding that renders a site the way a browser does |
| macOS | a child webview: WKWebView, WebKit | same, with Safari's engine |
| Linux | a child webview: WebKitGTK | same |
| the browser build | a card, and a sandboxed `<iframe>` once the reader presses it | a page in a browser has nowhere else to go, and no way to know whether a frame will work |
| Android and iOS | the system browser, not a tab | see below |

### A desktop: a webview over the pane

Tauri can put a second webview inside a window and give it bounds of its own.
That is what a web tab is: the pane leaves a hole in the document, measures it,
and the crate places the page exactly there. Nothing about the window changes and
nothing about the app's own webview is involved.

The one thing to know about the mechanism is that multi-webview support is behind
Tauri's `unstable` Cargo feature, which this crate now turns on. Unstable there
means the Rust API may be renamed in a minor release - not that the engine
underneath is experimental; it is the same WebView2 or WKWebView the app itself
runs in. What nib calls of it is `Window::add_child`, `Manager::get_webview` and a
handful of methods on the webview it hands back, all in one file, so an upstream
rename is one file to follow. See `apps/desktop/src-tauri/src/web_tabs.rs` and the
comment in `Cargo.toml`.

What the window may ask for is deliberately small: make a page, move it, show it,
hide it, send it to an address, step its history, read it for a clip, close it.

**Following the pane.** A resize observer on the hole for a pane being dragged,
the window's own resize, and a look after any press - and the crate is only told
when the answer has changed, so a keystroke in a note beside the page costs one
layout read and no IPC.

**Hidden when the tab is not showing, and taken down when nobody comes back.**
Switching tabs hides the page rather than closing it, because coming back to a tab
should not be a reload. After five minutes hidden the webview is closed and the
tab keeps its address: a window left open overnight with eight sites in it is
holding no browsers. Looking at the tab again opens the page where it was. Closing
the tab takes the webview with it.

**A native webview draws above every pixel of HTML in the window.** So while
anything of the app's is over the page - a menu, a sheet, the palette, the
settings - the page is hidden, or the menu would come up behind it. The app asks
the document which element is on top at the middle of the hole rather than keeping
a list of everything that can open, so a new kind of overlay is covered the day it
is written. The cost is that the page blinks out while a menu is open over it,
which is the honest trade: see "What is left" below.

**Back and forward are the page's own history.** Neither WebView2 nor WKWebView
hands Tauri a Go Back, so the step is `history.back()` in the page, which is what
a browser's own button calls. Whether there is anywhere to step is kept by the
crate as a trail of addresses, because the engine will not answer that either, and
a back arrow that is always lit is an arrow that lies half the time. A redirect
can leave an extra entry in the trail; that is the price of not having the engine's
own answer.

### The browser build: a card, and a frame when asked

A page in a browser can only be shown in a frame, and a great deal of the web
refuses to be framed: `X-Frame-Options: DENY` and CSP's `frame-ancestors` are a
header the site sends and the browser obeys.

**A page cannot find out whether framing worked.** That was measured rather than
assumed, with all four cases served side by side:

| the frame was pointed at | `load` | its location | its document | `length` | the resource entry |
| --- | --- | --- | --- | --- | --- |
| this origin, allowed | fires | reads back | readable | 0 | `iframe:200:363` |
| another origin, allowed | fires | throws `SecurityError` | null | 0 | `iframe:0:0` |
| another origin, refused | fires | throws `SecurityError` | null | 0 | `iframe:0:0` |

The two rows that matter are identical in every column. No site is on the app's own
origin, so there is nothing to read: the first design here tried to tell them apart
by the frame's own location and was simply wrong - it called a refusal a success,
which is the worse of the two mistakes.

So a browser build asks. The pane shows a card - the site's favicon, the page's
title, the origin - and two rows: **Show it here**, which swaps the frame in, and
**Open in the browser**, which takes the page where it will certainly work. One
press per tab and not per page: saying yes to a site is about this tab, and once
the frame is up, typing another address re-points it.

That is the gesture the app already has for a page embedded in a note, for the same
two reasons - the card cannot know whether the frame will work, and nothing should
be loaded from a site before the reader asks for it. See `web-embed.ts` in
`@nib/markdown` and `web-frame.ts` in `@nib/editor`.

**A HEAD request through the Worker would get rid of the press**, and is the only
thing that would: ask `services/sync` to fetch the headers and report. It was not
taken. It makes the app's own server a fetcher of arbitrary addresses on a reader's
behalf, which is a thing that gets used for something else; it is a round trip
before a page the reader has already chosen; and it needs the Worker reachable to
answer something about a page in front of them. If the press ever grates, that is
the route to write, with the loopback and private ranges refused and the answer
cached.

### A phone: the system browser

**Tapping a website on a phone opens the phone's browser.** It is the answer
rather than a gap.

A phone app's webview is the app's own: no extensions, no content blocking, none
of the reader's logins, no password manager, no reader mode, and no way to hand
the page on to anything else. Their browser has all of that. The pane is also 390
points wide, where a bar with six controls and a page is two things fighting for
one column. And Tauri has no child webviews on a phone at all - `add_child` is
desktop only - so the in-app option there would be a frame, which most sites
refuse.

The file is still theirs in the space: the note is a bookmark on a phone, which is
what a website on a phone is worth being. A tablet gets the frame and the card,
because it has the room.

## The bar

Back, forward, reload, the address, a clip, the dots. The same `.nib-glyph`
squares the find bar is made of, the same `.nib-field`, the same row scale, in the
same place under the tab strip - a bar over the page would cover the first line of
it.

The address field is one control with two faces. Nobody typing in it wants to read
a title and nobody reading wants to read an address, so it holds the whole address
while it has the keyboard and `svelte.dev - Svelte docs` while it does not. **The
origin is shown plainly either way**, with `www.` dropped the way every browser
drops it, and an `http:` page keeps its scheme in front of the host, because that
is the one thing about an address worth warning somebody about.

What somebody types is read once, in `web-tab/address.ts`: a host gets `https:`
(`localhost:1425` is a host and not a scheme, which is the special case every
browser makes), a scheme is taken as written so `javascript:` never opens, and
words are a search - DuckDuckGo, because the search has to go somewhere and that
is the one that asks for the least.

| key | |
| --- | --- |
| Ctrl+L | the address field, in the pane that has the focus |
| Alt+Left, Alt+Right | back and forward, which in a web tab is the page's history - the same key a note tab walks its own trail with |
| Escape in the field | puts the resting face back and lets go of the field |

Ctrl+L is the chord CodeMirror selects a line with, and both keep it. That works
because the bar reads it where the bar is rather than off the window: an app-level
binding never reaches the editor, so the two could not have shared it, while a pane
showing a page has no editor to shadow. It is in the registry like every other key
- `web.address`, under View - so it can be found and changed. The canvas's keys are
read the same way.

**While the page itself has the keyboard, its keys are the page's.** After a click
into a site, Ctrl+L is that site's shortcut and the app never sees the press: that
is what a webview of its own means, and the alternative would be registering an
accelerator with the operating system. The bar is one click away.

The dots hold what a browser keeps in the same place: open in the browser, copy
the address, clip the page, and what this site is allowed.

## Clipping the page

The Clip glyph writes the page into the space as a note, through the same two
functions the clipper extension uses: `@nib/markdown/from-html` for the words and
`writeFrontMatter` for the block above them, with `source:` and `date:` as the
extension writes them. A page clipped from a tab, the same page clipped from the
extension and a page pasted into a note come out as the same markdown.

On a desktop the crate reads the page with a script in the site's own document, so
what is clipped is what the reader can see rather than what the server sent. What
somebody has selected wins; with nothing selected it takes the article - the
element a page says holds its writing, or the longest candidate, and otherwise the
body with the navigation, the header, the footer and the forms cut out of it. Every
address comes back resolved, because the note is read from a folder and not from
the site.

The answer comes back through the engine's own script callback, not through the
app's IPC. That is what lets a page be read without the page being given anything
to call.

**In a browser build a clip is the link.** The frame's document belongs to
somebody else's origin and cannot be read at all, so the note is the title and the
address. The glyph says so before it is pressed: it reads "Clip the link" there and
"Clip this page" on a desktop, which is better than an apology afterwards.

The clip does not open in a tab. The page is still what the reader is looking at,
and a note that opened over it would take them away from what they were reading;
the row appears in the file list, which is where a clip belongs.

### The content policy

The app runs under a policy written once in `apps/desktop/src/csp.ts`, and a web
tab needed nothing added to it.

On a desktop the page is not in the app's document at all: a child webview loads a
site over the network, and Tauri's policy is injected into what Tauri's own
protocols serve. The site is governed by whatever policy the site sends, which is
how a browser works.

In a browser build the frame is the app's, and `frame-src 'self' https:` is already
what it needs - the line is there for the embed cards, and a web tab frames the same
way for the same reasons. The favicon on the card is covered by `img-src`'s `https:`,
and a card whose mark will not load shows no mark rather than a broken picture.

## Privacy and safety

**A page shares no session with the app.** The child webview is given a data
directory of its own - `web` inside the app's config folder on Windows and Linux,
a WebKit data store of its own on macOS - so a site's cookies and logins sit in a
profile the app's own session is not in, and clearing one never touches the other.
Cross-origin reading is the engine's rule in either case; this is about what sits
in the same store on disk. On macOS before 14 there is no such API and WKWebView
falls back to the default store, which is the one case where the two share a
profile.

**No nib IPC reaches the site**, three times over:

1. The capabilities name the app's own **webviews** rather than the windows they
   sit in. A capability that names a window grants every webview in that window,
   whatever its own label says - so a website in a tab would have been holding
   `opener`, the dialogs and the updater. The two patterns name the same two
   windows they always did, because a webview built by `WebviewWindowBuilder`
   carries the window's label, and a web tab's `web-...` is not among them.
2. A remote origin matches no capability here, which Tauri refuses on its own.
3. The globals that reach the crate are deleted before the page's first script
   runs.

**Every permission is refused, and refused by not being there.** The camera and
the microphone, the clipboard, where you are, and the buses a page can reach
hardware over: the APIs are taken off `Navigator.prototype` in the same script, so
the engine never has a request to prompt about. Two of them can be allowed by
hand, per site, from the dots menu - the camera, which stands for the microphone
because they are one API and a page that may watch you may hear you, and the
clipboard. Nothing else can be allowed at all: a note-taking app has no reason to
let a page talk to a USB device. Grants live on the device, never on the account,
and changing one builds the page again, because the guard runs once and a page
already running was built under the old answer.

**Only http and https, and never the app itself.** `file:` would read this
machine, a scheme the system knows would hand the page to another application, and
`tauri://localhost` would put nib inside a tab with the site's script beside it.
The rule is in the crate as well as in the app, because it is what every link
inside the page is judged by, not only what somebody types. A window the page asks
for leaves the app the way every other link does: the system browser.

**No collaboration.** A web tab holds no words, so it is never in a room and the
sync never has a document for it - not a switch that could be turned on by mistake
but a consequence of `holdsWords`, which is what decides whether a file's words are
a document at all. The file syncs like every other note.

## Where the code is

| | |
| --- | --- |
| `apps/desktop/src-tauri/src/web_tabs.rs` | the child webview: make, place, show, navigate, step, read, close. The guard script, the trail, the address rule. Unit tested |
| `apps/desktop/src-tauri/src/links.rs` | `url:` off every note, on the pass that already reads the icon |
| `apps/desktop/src-tauri/capabilities/default.json` | webviews, not windows |
| `apps/desktop/src/lib/web-tab/note.ts` | what the file says, and what a clip says. Pure, tested |
| `apps/desktop/src/lib/web-tab/address.ts` | what somebody typed, and the origin plainly. Pure, tested |
| `apps/desktop/src/lib/web-tab/frame.ts` | what a frame may do, and the measurements behind asking first |
| `apps/desktop/src/lib/web-tab/pages.svelte.ts` | the page each tab is on, the webview's life, the five-minute sleep |
| `apps/desktop/src/lib/web-tab/permissions.svelte.ts` | what each site is allowed, which is nothing |
| `apps/desktop/src/lib/web-tab/clip.ts` | where the HTML comes from |
| `apps/desktop/src/lib/web-tab/WebTab.svelte` | the pane: the hole, the frame, the card |
| `apps/desktop/src/lib/web-tab/WebBar.svelte` | the bar |
| `apps/desktop/src/lib/web-tab/menu.ts` | the dots |
| `apps/desktop/src/lib/file-mark.ts` | the globe, and the kinds a row can be |
| `apps/desktop/src/lib/workspace.svelte.ts` | `openWeb`, `openWebsite`, `keepWeb`, and the routing in `openEntry` |
| `scripts/web-tab-e2e.py` | the drive: the file, the mark, the tab, the card, the clip |

## What is left

- **The page blinks while something is over it.** A native webview cannot be drawn
  under the window's own HTML, so an overlay means hiding the page. The fix if it
  ever grates is the one reactive flag every overlay already could bump, rather
  than the element test the app makes now.
- **A browser build asks before it frames a page.** Nothing on the page can tell a
  framed site from a refused one, so the card asks; the Worker route above is what
  would remove the press.
- **A redirect can leave a spare entry in the back trail.** The engine will not
  say whether a navigation was a redirect, and the alternative is a back arrow
  that lies.
- **The article a clip takes is nib's own pick, not Readability's.** The extension
  runs Mozilla's extractor, which lives in `apps/clipper`; sharing it would mean
  moving `extract.ts` into `packages/markdown`, which is worth doing and is not
  this batch.
- **A web tab has no reading view, no export and no glasses.** There is nothing to
  render: the document is a window on somebody else's page. Clipping it is how a
  page becomes words this app owns.
