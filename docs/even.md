# Nib on the Even Realities G2

The plugin is the web app with one thing added: a bridge that keeps the glasses
showing whatever note is active in it. Same components, same stores, same
browser storage, same sign-in, same sync. It is served at
`https://nibeditor.com/even/`, and it does nothing at all in a browser that has
no glasses behind it.

![The first page of a note, as the simulator draws it](even/glasses-1.png)

Everything below was written against **`@evenrealities/even_hub_sdk` 0.0.15**
(published 2026-09-07), **`@evenrealities/evenhub-cli` 0.1.14** and
**`@evenrealities/evenhub-simulator` 0.9.5**. Where a fact came from the SDK's
own `dist/index.d.ts` or from a published document it is stated as such; where it
is an assumption, it says so.

---

## 1. The platform

### How an app is put together

An Even Hub app is a web page. The Even Realities phone app opens it in a
WebView (Chromium on Android, WKWebView on iOS) and the page talks to the
glasses over a channel the phone owns; no code of ours runs on the glasses
themselves. There are two ways to get a page in front of a pair:

- **Development.** `evenhub qr --url <address>` prints a QR code; the phone app
  scans it and loads that address directly over the network. Hot reloading
  works. The WebView is suspended whenever the phone app goes to the background,
  which is why this mode cannot be used to satisfy a review.
- **Release.** `evenhub pack app.json <build folder>` writes an `.ehpk`, which is
  uploaded in the developer portal and installed through the phone app. Files are
  served to the WebView from the phone.

The SDK is an ordinary npm dependency, but it is only a wrapper over a bridge the
host injects. Importing it puts a singleton on `window.EvenAppBridge`, a message
handler on `window._listenEvenAppMessage`, and sends everything out through
`window.flutter_inappwebview.callHandler('evenAppMessage', …)`. Outside that
WebView every call fails, which is why `sdk.ts` checks for the host handler
before importing the SDK at all.

### `app.json`

`apps/desktop/even.app.json`. Nine keys, and the CLI's own schema accepts no
others (extra keys are dropped silently, which is worth knowing before inventing
one). There is **no icon field**: the portal takes the icon as an upload.

| Key | Rule |
| --- | --- |
| `package_id` | reverse domain, `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`. No hyphens, no underscores. |
| `edition` | exactly `"202601"` |
| `name` | at most 20 characters, and **must not contain "Even"** in any case: names that do are rejected as impersonation |
| `version` | `x.y.z`, no prefix, no pre-release |
| `min_app_version` | the phone app floor; `evenhub pack` stamps it from the SDK unless `--enforce-manual-version` |
| `min_sdk_version` | the SDK built against |
| `entrypoint` | a path inside the build folder: for us `even.html` |
| `permissions` | array of `{ name, desc }`, plus `whitelist` for `network` |
| `supported_languages` | from `en de fr es it zh ja ko`. Swiss German has no code here, so it is not listed. |

Our `network` whitelist is `https://nibeditor.com`: one entry per full origin,
no wildcards, no bare hostnames. The phone app blocks any request to a host that
is not on it before the request leaves the WebView, and CORS still applies on top
of that. See "What still has to be decided" below.

### The display

- **576 by 288 pixels, four bits a pixel: sixteen levels of green.** Level zero
  is a pixel that is off, which on these glasses is see-through rather than
  black. So a page is drawn as light on nothing.
- At most **four image containers and eight text or list containers**, twelve in
  all, and exactly one of them must carry `isEventCapture: 1`.
- An **image container is at most 288 wide and 144 tall**. The panel therefore
  takes exactly four of them, which is also the most that are allowed.
- An image container **cannot** capture events. The documented pattern is a
  full-screen text container behind them with `content: ' '`, which is what the
  plugin does; `zOrderIndex` decides the stacking and does not touch input
  routing.
- A **text container has no typography at all**: one font baked into the
  firmware, no family, no size, no weight, no slant, no alignment, a fixed 27
  pixel line, and five brightness levels (`textColor` 0 to 4). This is the single
  most important fact on this page; see section 3.
- `updateImageRawData` takes `{ containerID, containerName, imageData }` and
  nothing else: no width, no height, no stride. The container says how wide the
  rows are. `imageData` may be a `number[]`, a `Uint8Array`, an `ArrayBuffer` or
  base64, and the plugin sends `number[]`, which the SDK's own note says the host
  takes best.
- **Encoded image bytes (PNG) are the documented format**: the host decodes,
  scales and does its own reduction to four bits, and its own display notes say
  its reduction is better than one done in the app. Raw Gray8 and packed Gray4
  are also accepted (simulator changelog 0.9.2), but **the packed byte layout is
  not published anywhere** - not the nibble order, not the row padding. So the
  plugin sends PNG. `encode.ts` can pack Gray4 and is tested round trip, and
  `Sheets` will use it on request, but it is not the default and its layout is an
  assumption until somebody publishes one.
- Compression is not an API. SDK 0.0.12 added LZ4 inside the image path; there is
  no flag.

### What a page costs

Measured on a G2 (firmware 2.2.7.14, Even App 2.2.7, SDK 0.0.13) and published in
the community notes:

| Call | Cost |
| --- | --- |
| `updateImageRawData` | about 104 ms fixed, plus 3.9 ms per KB of the gray4 buffer |
| `rebuildPageContainer` | about 165 ms, flat, whatever it holds |
| `textContainerUpgrade` | about 83 ms |
| `createStartUpPageContainer` | 100 to 135 ms |

The fit is `ms = 104 + 0.0039 x bytes`, where `bytes` is `width x height / 2`,
the gray4 buffer, not the size of the PNG. The costs are **additive across
containers**: one 58 by 58 container is 111 ms a frame, two are 221, four are
442. SDK 0.0.14 added a 100 ms hold on the image path on top of that, which is a
floor rather than the same thing.

For a full panel: each quadrant is 288 x 144 = 20,736 bytes of gray4, so about
104 + 81 = **185 ms a quadrant, 740 ms for all four**. The published table
measures exactly that for a 288 by 144 container.

### Input

Everything arrives through one subscription, `onEvenHubEvent`. The gestures are
`CLICK`, `DOUBLE_CLICK`, `SCROLL_TOP`, `SCROLL_BOTTOM`, `LONG_PRESS` and
`LONG_PRESS_RELEASE`. `eventSource` says whether it came off the right temple
(1), the R1 ring (2) or the left temple (3).

**The ring is not a separate input surface.** It sends the same gestures a temple
sends and is told apart only by `eventSource`. There is no rotation, no encoder,
no delta. Head gestures are not exposed either: the only head data is raw IMU
through `imuControl`. This is why the plugin turns pages rather than scrolling
smoothly, and it is not a shortcut: a page turn is the interaction the hardware
offers.

Two traps, both guarded in `sdk.ts` and both covered by tests:

1. **Protobuf leaves a zero field out, and `CLICK_EVENT` is zero.** A single tap
   arrives as `{ sysEvent: { eventSource: 1 } }` with no event type at all. The
   default has to be read *inside* the check for the envelope; read outside it,
   every scroll, every lifecycle event and every audio frame becomes a tap.
2. **A double press must be matched before a single one.**

A swipe reaches the container that captures events, which for us is the text
container, so it arrives on `textEvent`. A press is always a `sysEvent`.

### The page's life

There are no mount or unmount hooks. `createStartUpPageContainer` is called
**exactly once** - a second call is refused, and refused after blocking for a
couple of seconds - and after that the page is changed with
`rebuildPageContainer`, `textContainerUpgrade` and `updateImageRawData`. What has
to be latched is that startup was *called*, not that it *succeeded*.

Lifecycle events arrive on `sysEvent`: foreground (4), background (5), abnormal
exit (6), system exit (7). The firmware sends a pair about a tenth of a second
apart for one physical transition, so they are folded together over 600 ms.
Gestures are not folded: two swipes are two pages.

A double press on the root page must call `shutDownPageContainer(1)`, which puts
the system's own leave-this-app question up. Reviewers check for it.

### The simulator

```sh
npx @evenrealities/evenhub-simulator http://localhost:5173
```

A native desktop application that hosts a WebView, injects the real bridge and
draws a 576 by 288 LVGL framebuffer. It takes the address of *your* server; it
serves nothing itself. `--automation-port <port>` opens an HTTP API on
`127.0.0.1`:

| Route | What it does |
| --- | --- |
| `GET /api/ping` | answers `pong` |
| `GET /api/screenshot/glasses` | the framebuffer as a 576x288 RGBA PNG |
| `GET /api/console?since_id=N` | the WebView console |
| `POST /api/input` | a JSON `action`: `up`, `down`, `click`, `double_click`, `long_press`, `long_press_release`, `context_menu` |

It does not simulate BLE timing, frame pacing, memory limits or the firmware's
own font, and it hardcodes `eventSource` to 1. So it proves that a page is built,
accepted and drawn; it proves nothing about how long that takes.

---

## 2. The renderer

`packages/glasses` turns a note into pages of pixels. Everything but `raster.ts`
and `fonts.ts` is pure TypeScript with no DOM in it, which is what lets the
layout be tested without a browser.

```
blocks.ts   the app's own markdown grammar, flattened into blocks
code.ts     a fence, told apart into token kinds by the editor's own parsers
grey.ts     the code theme in sixteen greys
runs.ts     styled pieces, and the editor's own ligature glyphs among them
layout.ts   blocks into lines, lines into pages
hash.ts     what a page is, in one short string
raster.ts   a page drawn to pixels, on a canvas nobody sees
encode.ts   pixels into the bytes the glasses want
sheets.ts   all of the above, in order, cached by page
```

### One grammar, one set of faces

The blocks come from `lexMarkdown` in `@nib/markdown`: the same tokens the
reading view and a published page are built from, with the same maths, callouts,
definition lists, emoji and wikilinks. The faces are read from the theme's own
tokens at draw time, so a note on the glasses is set in whatever the app is set
in. Neither is a copy that can drift.

The ligature glyphs come from `findLigatures` in the editor package, which reads
the editor's own `LIGATURES` table, and they honour the account's scope: nowhere,
in code only, or everywhere. A glyph is drawn over the width the characters it
stands for would have taken, exactly as the editor paints it over them, so a
fence's columns still line up.

### The measure

A 576 pixel panel with a 10 pixel margin leaves 556. Body text is set at 16 px in
the content face, which averages a little under half its size per character:
about 70 characters to the line, which is what a page of prose wants. A test
asserts the number stays between 60 and 80, so a change to the size or the
margins that walks out of that band fails rather than ships.

Leading is 1.3 rather than the app's 1.72. The panel has 268 usable pixels and
every tenth of leading costs a line.

The note is set **across the whole width**, left aligned, not down a column in
the middle. A column would throw away two thirds of the glass.

### Telling code apart without colours

A palette tells a keyword from a string by hue, and the panel has no hue. Drawing
eight token kinds as eight brightnesses puts most of them within one step of each
other, which on glass is no difference at all. So brightness carries part of the
distinction and weight and slant carry the rest: six bands of grey, read plain,
bold or italic.

The bands do not overlap *within one emphasis*, which is the whole of why two
roles can never look alike: two roles at the same brightness are always plain
against italic, or plain against bold. The palette chooses only where inside its
band a role sits, so switching the code theme still changes what the glasses
show, and no theme can make its own comments brighter than its own keywords.

Brightness is not taken from the palette's own luminance, and that is deliberate:
a palette is made for paper or for a dark window, where a keyword may well be the
darkest thing on the line, and the panel lights pixels rather than inking them,
so dark means invisible.

### Where a page ends

A page ends between lines, never inside one. A line that only exists because the
one before it ran out of room - the second half of a wrapped line of code, the
words under a heading, the first row of a table under its head - is glued to it,
and the two move to the next page together. That is the rule that keeps a page
break out of the middle of a line of a fence, and it is tested.

Every page carries `from` and `to`: where in the note it starts, counted from the
first byte of the file, front matter included. `pageAt` runs the map the other
way. Both are what keep a reader in place when the note is edited under them.

### Formulae and pictures

KaTeX renders a formula to HTML; the HTML goes into an SVG `foreignObject` with
the app's own KaTeX stylesheet and its faces inlined as `data:` URIs (which
`math-fonts.ts` already builds for exports), and the SVG is decoded into a
picture the canvas draws. A formula that cannot be drawn falls back to its own
source in the mono face, and takes the room the source takes, so the line breaks
where it will actually break either way.

Both are prepared before the note is laid out, not while it is drawn: a line
cannot be broken until its formula's width is known.

Pictures are quantised with an ordered dither. Text never is: the display notes
warn that diffusing error over a panel this coarse comes out as moving speckle,
and a dither over small type is mush.

### Measurements

Taken in Chromium against the real fonts, with the faces already loaded.

| | |
| --- | --- |
| A 20 KB note, all pages laid out | **78 to 84 ms**, 55 pages |
| The sample note in `docs/even/`, first render, with maths | 211 to 226 ms |
| The same note again, no maths to prepare | 64 to 66 ms |
| A page drawn and cut into four PNGs | about 20 ms |
| One quadrant as PNG | 7 to 15 KB, against 20,736 bytes of gray4 |

The 200 ms target for a 20 KB note is met with room to spare; the first render of
a note with formulae in it spends most of its time in KaTeX and in decoding the
formula pictures, and every one of those is cached afterwards.

Each page's bitmap is produced once and kept under a hash of everything that
decides a pixel: the words, the styles, the positions, the greys, and the page
count in the corner. Scrolling back through a note costs nothing, and an edit
that leaves a page alone leaves its bytes alone.

---

## 3. Bitmaps or text containers: the decision

**The plugin draws every page as a bitmap. It uses a text container only as the
event layer, and as a fallback when the image channel dies.** This was the
question the design turned on, so here is the arithmetic and the reasoning.

### What each costs

A full panel is four image containers of 288 by 144:

```
4 x (104 + 0.0039 x 20736) = 4 x 185 = 740 ms
```

A page of prose put into one text container instead is one
`textContainerUpgrade`: **83 ms**. Nine times cheaper.

The plugin does better than 740 ms in practice, because a page turn sends only
the containers whose pixels moved. Every container starts empty and every empty
quadrant hashes alike, so the dark part of a page costs nothing at all: a page
with the bottom half empty is two sends, about 370 ms. The skeleton is made once
and never rebuilt, so the flat 165 ms of `rebuildPageContainer` never appears in
a page turn.

### Why the bitmaps win anyway

1. **Fidelity is the point.** A text container has no font, no size, no weight,
   no slant, five brightness levels and a fixed 27 pixel line. Headings, bold,
   italic, ligature glyphs, coloured code, tables, formulae, pictures: none of
   them survive it. Half of what a note means would be gone.
2. **One design everywhere.** A note whose plain pages are set in the firmware's
   font and whose code pages are set in ours changes typeface as the reader turns
   pages. That is worse than either alone.
3. **One page model.** A hybrid needs the firmware's metrics for prose (27 pixel
   lines, its own font, measured with `@evenrealities/pretext`) and ours for
   everything else, which means two sets of page breaks. The page a note is left
   on, the map from a page back into the note, and the "this page has not moved,
   send nothing" rule all stand on there being one.
4. **The interaction is a page turn, not a frame rate.** The ring and the touch
   bar deliver discrete swipes and no deltas. The target is a page under a
   second, and 370 to 740 ms is that.

### What the hybrid would buy, and when to take it

About half a second on a page that happens to be plain prose. If measurement on
real hardware shows page turns materially worse than the published fit, the lever
to pull is in `screen.ts`: classify a page in `Sheets` as plain or drawn, and
give a plain page to the capture layer with `textContainerUpgrade` instead of to
the four image containers. The layout would have to be re-measured at the
firmware's 27 pixel line for those pages, and the three costs above would have to
be accepted. It is deliberately not built.

### What the text container does do

- It is the **event layer**. One container per page may capture, an image
  container may not, so a full-screen text container sits behind the four image
  containers with `content: ' '`. A single space means no overflow, so a swipe is
  at both ends of it at once and reaches us instead of scrolling something
  invisible.
- It is the **fallback**. There is a documented fault where, after the
  leave-this-app question has been up, every `updateImageRawData` returns
  `sendFailed` for the rest of the app's life with no way back. When the plugin
  sees that, it puts the page's words into the capture layer instead. It loses
  the faces, the code colours and the tables, and the note is still readable.

---

## 4. The bridge

`apps/desktop/src/lib/even/`, four files and a corner:

| File | What it is |
| --- | --- |
| `sdk.ts` | the Even Hub bridge, read field by field at the boundary |
| `screen.ts` | the five containers, and how a drawn page reaches them |
| `session.ts` | which note the glasses show and which page of it |
| `bridge.svelte.ts` | the tie to the app's own stores |
| `Glasses.svelte` | two numbers and a pair of lenses, in the corner |

### The rules

- **The note active in the plugin is the note on the glasses.** The bridge
  watches `workspace.active`, the note's `revision`, and the two settings that
  change how a note looks (the ligature scope and the code theme), all in one
  derived value.
- **Switching notes in the plugin switches the glasses.**
- **Closing the note in the plugin leaves it on the glasses** until another note
  becomes active. This needs nothing done to hold: the session is only ever told
  what *is* active, and being told nothing changes nothing.
- **The glasses scroll on their own**, by pages, independently of the phone's own
  scroll, and every note remembers the page it was left on for the sitting.
- **An edit keeps the reader on the words in front of them.** The page they were
  on, wherever it moved to, since a page is its pixels and its hash says when two
  are the same page. Where the page itself changed, the place in the note they
  were at. And if nothing they can see has moved, nothing is sent at all.
- Nothing goes over the network for any of it. The note is in memory.

A keystroke does not reach the glasses at once: the bridge waits 700 ms for the
typing to stop, because a page costs the best part of a second on the radio.

`session.ts` knows nothing about Svelte, a canvas or a radio, which is what makes
those rules testable rather than hopeful. There are 18 tests on them.

---

## 5. Serving it at `/even/`

The build writes two pages out of one bundle: `index.html` (the editor) and
`even.html` (the plugin). Almost all of the output is shared; the plugin's own
code and the Even Hub SDK are chunks nothing in `index.html` reaches, so the
plain web build carries none of it. That is checked: `dist/index.html` mentions
neither.

The Worker in `services/sync` serves `apps/desktop/dist` through its assets
binding. Its not-found handling is `single-page-application`, which would answer
`/even/` with the editor's own page, so two routes are named ahead of the
catch-all and ask for `/even.html` by name.

### Where a packed plugin actually runs, and what it may keep

Undocumented by the platform, and settled on a real device on 2026-09-08. The
plugin's own diagnosis panel, photographed on a Samsung SM-S948B running Android
16, said:

```
origin      http://127.0.0.1:42479
protocol    http:
href        http://127.0.0.1:42479/
agent       ... Android 16; SM-S948B ... wv) ... Chrome/151 Mobile Safari
last launch #5
localStorage  empty
cookie        kept 5
indexedDB     empty
```

**A packed plugin is served by a local HTTP server on `127.0.0.1`, on a port
picked afresh every launch.** That one fact explains everything that was wrong
with this plugin for a week:

- The origin is `http://127.0.0.1:<port>`, and a different port is a different
  origin. `localStorage` and IndexedDB are keyed by origin, so both come up
  **empty on every launch** - not wiped, simply somebody else's. Signing in and
  being asked to sign in again next time is what that looks like.
- **Cookies ignore the port.** `http://127.0.0.1:41234` and
  `http://127.0.0.1:42479` are different origins but the same cookie host, which
  is why the cookie was the one page store that survived, five launches running.
- The host's own store, through `setLocalStorage`, survives because the phone
  app holds it rather than the page.

So the two stores that matter are **the cookie and the host store**, and they
fail in different ways: the cookie is limited to about 4 KB and is the only one
that works before the channel arrives, and the host store is unbounded in
practice but answers nothing until it does. `localStorage` and IndexedDB stay in
the list as free fallbacks for the browser and the desktop app, where they are
the ones that work. See `src/lib/even/keep.ts`.

The community had reported the symptom - "browser localStorage does not survive
app restarts inside the `.ehpk` WebView", in `nickustinov/even-g2-notes` - but
not the cause. The cause is the port.

### What goes into the package, and why it is not `dist`

`pnpm --filter @nib/desktop build:even` builds, then stages
`apps/desktop/dist-even` through `scripts/even-stage.mjs`. In that folder
**`index.html` and `even.html` are the same page, and that page is the plugin**;
the editor's own `index.html` is not in it at all.

That is not tidiness. Which page the phone app opens from a package is published
nowhere: the manifest names `even.html` as the `entrypoint`, but an app that
opens `index.html` instead would get the plain editor, which signs in, syncs,
and knows nothing about any glasses. A plugin that signs in and then does
nothing on the glasses is exactly what that looks like from the outside, and it
is indistinguishable from a bridge that was never found. Staging both names as
the plugin removes the question rather than answering it.

`even.html` also paints one line of its own, `Nib for G2`, before any script
runs, and the app removes it on mount. The editor's page has nothing like it, so
seeing it at all says the plugin's page was loaded, and seeing it stay says the
page loaded and its script did not.

---

## 6. Getting it onto the glasses

Two ways. The first needs nothing from anybody and works today; the second is
what a beta tester installs.

### A. The quick way: scan a QR code

1. On the phone: **Even Realities app -> Hardware -> Enable Developer Mode**.
2. On a computer:
   ```sh
   npx @evenrealities/evenhub-cli qr --url https://nibeditor.com/even/
   ```
3. In the phone app, open the **Even Hub** tab, tap **Scan QR**, and point the
   camera at the terminal. The glasses draw the plugin within a second or two.

The origin is then `https://nibeditor.com`, which the sync API's CORS list
already allows, so signing in and syncing work as they do in a browser. The
catch: the moment the phone app goes to the background - lock screen, app
switcher, Control Center - the WebView is suspended and the page usually comes
back blank until the QR is scanned again. Fine for looking at it, not fine for
living with it.

To point it at a laptop instead of at production, serve the app on the LAN and
pass that address:

```sh
pnpm --filter @nib/desktop exec vite --host 0.0.0.0 --port 5173
npx @evenrealities/evenhub-cli qr --http --port 5173
```

### B. The real way: a beta build

**Once, to get a developer account**

1. The Even account is created in the **phone app**; the web hub has no sign-up.
2. Sign in at `https://hub.evenrealities.com/login` with the same email and
   password. You land on an empty publisher dashboard.
3. Sign the CLI in with the same account:
   ```sh
   npx @evenrealities/evenhub-cli login -e me@emilvinu.de
   ```
   It stores a token at `%APPDATA%\evenhub\credentials.yaml`. (It obfuscates the
   password by XORing it against the email before sending, which is not
   encryption; the transport is HTTPS. Do not reuse that password anywhere.)
4. Check the package id is free:
   ```sh
   npx @evenrealities/evenhub-cli pack apps/desktop/even.app.json apps/desktop/dist-even -c
   ```
   There is no separate registration step: the id is claimed by the first upload.

**Every time, to ship a build**

1. Build and pack:
   ```sh
   pnpm --filter @nib/desktop build:even
   npx @evenrealities/evenhub-cli pack apps/desktop/even.app.json apps/desktop/dist-even -o nib.ehpk
   ```
   About 4 MB, well inside the roughly 10 MB the platform is comfortable with.
   The CLI stamps `min_app_version` from the SDK it reads on npm.
2. In the portal, open the project and go to **Builds**. Upload `nib.ehpk`. It
   arrives as **Draft**.
3. Move the build from Draft to **Test**.
4. Go to **Beta groups**, make a group (`self-test` will do), and add your own
   **account email**. Add anybody else's email to have them test the same build.
5. Push the build to that group.
6. On the phone: **Even Realities app -> Me -> Beta tester**, find the build, tap
   **Install**. From there it behaves as a released app: it is launched from the
   glasses home menu and gets the full lifecycle, real backgrounding included.

A tester needs nothing but the phone app. If a build will not install for
somebody, the usual cause is a `min_sdk_version` above their firmware.

**The icons**

The portal asks for a **pair** of images, an icon and a background, and rejects
anything with colour in it. The sizes are not published anywhere, so
`scripts/even-icon.mjs` writes both at two sizes:

```sh
node scripts/even-icon.mjs
```

`docs/even/icon-24.png`, `icon-256.png` and their two backgrounds: the Nib mark
in greyscale, eight bit grey plus alpha, no colour channel to be rejected for.
Upload whichever size the field asks for.

**Submitting for release** (not yet, but for when it comes)

Draft -> Test -> Submitted -> Released, with one way back: a rejection returns a
build to Draft with notes. Once Released there is no rollback; a change means a
higher version. The review checks, among other things, that a double press on the
root page raises the exit dialogue (the plugin calls `shutDownPageContainer(1)`),
that setup survives a restart, that every permission asked for is actually used,
and that the app survives the phone being locked for five minutes. Decision
emails come from `noreply@evenrealities.com` and do not say the outcome; they
carry a link.

---

## 7. What was checked, and where

In the **official simulator 0.9.5**, driven through its automation API, with the
plugin served from a local Vite server and the **real SDK** doing the talking:

- `createStartUpPageContainer` accepted the five container page: one full-screen
  text container with `isEventCapture: 1` at `zOrderIndex` 0, and four 288 by 144
  image containers tiling the panel at 1 to 4.
- Four `updateImageRawData` calls landed and drew. The console showed the
  bridge initialise and five `evenAppMessage` calls, and no errors.
- The pages below are the framebuffer, read back through
  `GET /api/screenshot/glasses`. Headings, bold, italic, the ligature glyphs, the
  boxed inline code, a coloured fence, a table with its grid, inline and display
  maths, and the page count in the corner.
- `POST /api/input {"action":"down"}` turned the page; a second turned it again;
  a third at the end did nothing; `"up"` went back. The corner tracked.

![Page 2 in the simulator: a table, inline and display maths](even/glasses-2.png)

![Page 3 in the simulator, the last one](even/glasses-3.png)

In **Chromium through Playwright**, against the plugin entry itself with a
stand-in bridge installed before the page ran:

- `even.html` booted the whole app, connected, made the page, and sent bitmaps
  for a note typed into the editor by the keyboard.
- A swipe turned the page and the corner said `2/2`.
- No console errors.

And the page bitmaps as they are sent, in `docs/even/page-1.png` to `page-4.png`.
Those are the greys; the simulator captures above are what the glasses make of
them.

**Not checked, and cannot be from here:** anything about timing. The simulator
does not simulate BLE, pacing or memory. Every number in section 1 is from the
published measurements, and the first thing worth doing on real hardware is to
time a page turn and compare.

---

## 8. What still has to be decided

1. **CORS for a packed build.** The WebView's origin inside an `.ehpk` is not
   documented anywhere; Even's own networking page says to send
   `Access-Control-Allow-Origin: *` "or specifically the WebView origin if you can
   identify it", which is the platform declining to say. The sync API allows a
   fixed list of origins (`services/sync/src/index.ts`), which covers the QR flow
   because that loads `https://nibeditor.com` directly, and will not cover a
   packed build. Nothing has been changed there: widening the API's CORS is a
   decision about the API, not about this plugin. When it is time, the options
   are to allow a null or absent `Origin` on `/v1/*`, or to allow `*` there and
   keep relying on the bearer token, which the app already does and which is what
   the platform's own guidance assumes.
2. **The packed Gray4 layout.** If it is ever published, `Sheets` takes
   `format: 'gray4'` and `encode.ts` already packs it, two pixels to a byte with
   the left pixel in the high nibble and no row padding. That is an assumption,
   it is stated as one in the code, and it would want checking against the
   simulator before it is trusted.
3. **Memory.** Four image containers at the maximum size is legal on paper and
   nobody publishes a budget; `createStartUpPageContainer` answers `outOfMemory`
   (3) if it is too much, and the plugin reports that as a page it could not
   make. The simulator enforces no limit, so this is the other thing to watch on
   real hardware.
4. **Embedded notes.** A `![[note]]` renders as the words it showed rather than
   as the note it names. The reading view resolves those through the link index;
   the glasses do not, yet.

---

## 9. Trying it here

```sh
pnpm --filter @nib/desktop exec vite --port 5173
npx @evenrealities/evenhub-simulator --automation-port 1438 http://localhost:5173/even.html
```

The plugin needs a note to be active before there is anything to show, so open or
write one in the simulator's own WebView (right click, Inspect Element, if
something needs looking at). Then:

```sh
curl http://127.0.0.1:1438/api/screenshot/glasses -o page.png
curl -X POST -H 'content-type: application/json' -d '{"action":"down"}' \
  http://127.0.0.1:1438/api/input
```
