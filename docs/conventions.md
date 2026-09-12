# Conventions

What the code is held to, and how to check it before a commit. CI runs the
same commands on every push to `main`.

## Product

- As little text as it gets. No explanatory copy; a shape, a position or a
  short word says it. Nobody should have to learn the app: it behaves the way
  a person would guess, following file-manager, browser-tab and Typora habits.
- One design everywhere. The tokens in `packages/themes/src/tokens.css` are
  the only colours, spacings, radii and durations; a new surface reuses an
  existing component shape before it invents one.
- It answers at once and it moves. Every click has a pressed state, changes
  show optimistically, and state changes are eased with the short transitions
  already in use (100 to 190 ms). Editing a note should feel really nice.
- Fast is a feature. Nothing done per keystroke may scale with the document;
  measure before and after, and keep the numbers in the commit message.
- Well-written code is a requirement: DRY, one responsibility per file, small
  functions with names that say what they return.

## Layout

| Package | What it owns |
| --- | --- |
| `packages/editor` | The CodeMirror 6 live-preview editor: parsing, decorations, widgets, commands. No app concerns. |
| `packages/markdown` | The renderer used for export and publishing, and the converter back the other way that a paste and the clipper share. Pure functions between markdown and HTML. |
| `packages/themes` | Design tokens and the stylesheets, shared by the editor, the app and published pages. |
| `packages/glasses` | A note as pages of pixels for the Even Realities G2. Pure but for the rasteriser; see `docs/even.md`. |
| `apps/desktop` | The Svelte 5 app (stores in `src/lib/*.svelte.ts`, components in `src/lib/*.svelte`), the browser shim in `src/lib/web`, and the Tauri crate in `src-tauri`. |
| `apps/cli` | `nib`, which drives the running app over its local endpoint. One Node script, no dependencies, and no knowledge of what any verb does; see `docs/automation.md`. |
| `services/sync` | The Cloudflare Worker: sync, publishing, MCP, accounts, and the theme store's catalogue. Tests run routes against real SQL. A published page is the note; see `docs/publishing.md`. |

One file, one responsibility. A file that has to explain two jobs in its
header comment is two files.

## Security

A note is a file, and a file can come from anywhere: a download, a repository,
a folder somebody shared. Four rules follow, and none of them is widened
quietly: a change that touches one says so where it is made.

- **Whose markup is markup.** Raw HTML in a document of the reader's own is
  rendered, the way Typora and Obsidian render it. In a room, in a shared
  space, in anything a guest can see, and in anything markup was pasted into,
  it is the characters it is made of. The one place that decides is
  `apps/desktop/src/lib/trust.ts`; every surface asks it through
  `trustsHtmlIn` or `trustsHtmlAt` and passes the answer to the renderer as
  `escapeHtml`. A published page always escapes: blogs share a domain.
- **Nothing runs in the app.** Code that came out of a note runs in a frame
  sandboxed without `allow-same-origin`, so its document has an opaque origin
  and the app's DOM, storage and notes are cross-origin to it. That is the
  ` ```js ` fence (`packages/editor/src/run`) and a block of a note's own HTML
  (`packages/markdown/src/html-block.ts`), and both wait for a press.
- **Nothing loads from a third party until the reader asks.** An address a
  note points at is a card the size the frame will be, and the frame arrives on
  a press; see `packages/markdown/src/web-embed.ts`.
- **A path somebody else wrote is judged before anything on disk is touched.**
  `apps/desktop/src-tauri/src/paths.rs` holds the four judges, strictest first.
  `a_space`: a folder directly inside the spaces folder, for the commands that
  move a whole tree. `in_spaces`: inside the spaces folder and not the trash,
  which is every note, folder, tree, search and trash command. `beside_a_note`:
  that, or beside a note the app was asked to open from elsewhere, which is the
  reach a note's own pictures get. And `chosen`, which is any path at all.

`chosen` is the deliberate exception, not a gap in the other three: nib edits
files, and a file worth editing is wherever it already is, so `read_note`,
`write_note`, `write_bytes`, `file_stamp` and `import_document` take whatever
path they are handed. It checks that the string names a file, and `folded`
_collapses_ a `..` rather than refusing it, so a path climbing out of a space
is not an error there: it is a different file, created if it is missing and
replaced if it is not. Those five are safe because of what
stands in front of them, which means a new caller of one of them is exactly
where that stops being true:

- **The window's own gestures.** The path came from the file dialog, the
  command line, a shell hand-off, or `joinPath` off a space root. The reader
  chose it.
- **The local endpoint and every `nib://` link**, the two roads another
  program has in. Both are judged by one function, `insideOnly` in
  `apps/desktop/src/lib/automation/inside.ts`: relative, `/` separators, no
  `..`, no drive letter, no control character, no name Windows keeps for a
  device. `insideSpace` then only concatenates, which cannot leave a root
  given steps that hold no `..`. A link reaches four verbs and no writing
  one; `eval` is refused in the crate, before the window is asked, unless
  the endpoint file turns it on.
- **A link inside a note**, because a note can arrive from a shared space, a
  room, a pull or a paste, so its prose is somebody else's. `followLink` in
  `apps/desktop/src/lib/workspace.svelte.ts` judges the target with that
  same `insideOnly` before making the note a link names.
- **A sync pull**, whose names were written by whoever shares the space:
  `placeable` in `apps/desktop/src/lib/sync/mirror.ts`.
- **An import**, where every format reader puts each path component through
  `safeName` before `applyImport` joins it to the space root. The check
  lives in the readers, so a new format that forwards a zip entry's own name
  unsanitised is a new hole; nothing at the write site would catch it.
- **The browser build**, which has no filesystem: the same three commands
  are rows in IndexedDB (`apps/desktop/src/lib/web/commands.ts`), and
  `web/paths.ts` clamps at the virtual root.
- **The phone**, whose spaces folder is inside the app's own external files
  directory and whose manifest asks for no storage permission, so the whole
  of `chosen`'s reach there is this app's own sandbox. A share hands over
  bytes and a name, never a path. The one road bounded by nothing but that
  sandbox is the `open` intent extra in
  `apps/desktop/src/lib/mobile/handed.ts`, which the widget sends as an
  absolute path and which reaches `read_note` unjudged.

So: a path that came from outside the app is judged by `insideOnly` on the
window's side, or by `in_spaces` in the crate, before it reaches any of those
five. A caller that skips both is the bug, not the command.

The policy that backs the first three is `apps/desktop/src/csp.ts`, which is
the one copy of the app's `Content-Security-Policy`: the Tauri config,
`index.html` and the dev server all carry it and
`apps/desktop/test/csp.test.ts` holds them to each other. Two lines in it are
load-bearing. `script-src-attr 'none'` is why
an `onerror` in a file somebody was handed is inert even where that file's
markup is rendered. And `script-src-elem 'unsafe-inline'` is why the sandboxed
frames above still work at all: a `srcdoc` document inherits the policy of the
page that made it, so a policy with no room for an inline script is a policy
that switches those two features off. Prove a change to it with
`python apps/desktop/test/e2e/frames.py`, which serves the built app under the
policy as a header and fails on any violation the browser reports.

## Checks

```sh
pnpm check          # types: tsc per package, svelte-check for the app
pnpm lint           # eslint, type-aware, strict rule sets
pnpm format:check   # prettier; `pnpm format` rewrites
pnpm knip           # unused files, exports and dependencies
pnpm test           # vitest in every package
```

The Rust crate: `cargo fmt --check`, `cargo clippy -- -D warnings` (the lint
policy lives in `Cargo.toml`), `cargo test`. It does not compile on every
machine; CI is the reference.

## Drives

`apps/desktop/test/e2e/*.py` is a drive each: it serves the built web app on a
port of its own, seeds a space through `window.nibApp`, walks the app in the
machine's own Chrome and photographs what it found into
`apps/desktop/test/e2e/shots/`. A drive that checks something exits non-zero
when it does not find it; the rest print what they saw. They are not in `pnpm
test`, because each one is a build and a browser.

The whole set, one build and then one drive at a time:

```sh
python apps/desktop/test/e2e/run-all.py              # build once, run all
python apps/desktop/test/e2e/run-all.py --no-build   # reuse apps/desktop/dist
python apps/desktop/test/e2e/run-all.py --only tree  # the drives matching a word
python apps/desktop/test/e2e/run-all.py --list       # what would run, in order
```

It prints a table of what passed, what it cost and where the screenshots went,
and exits with the number of drives that failed. Every drive is run with
`NIB_SKIP_BUILD=1`, which is how a drive is told the build in
`apps/desktop/dist` is the one to use; a new drive should honour it. The build
is a development one, because a production build hides the `window.nibApp` the
drives seed through.

One set at a time on a machine. Every drive serves the same
`apps/desktop/dist`, and a drive that builds replaces it: a build landing under
a drive that is already running changes the asset hashes it is fetching, and the
page fails on a chunk that is no longer there rather than on anything about the
app. The runner is one drive at a time for that reason, and two runners at once
undo it. Ports belong to the machine too, so a drive run by hand beside a set
takes the port the set was going to want.

A run leaves the working tree dirty in one place: `store-shot.py` writes
`docs/media/screenshot.png`, which is tracked. Keep it when the app's look has
changed and it is the shot you wanted; otherwise check it out again.

Six of them - `collaborate`, `draw-together`, `first-sync`, `publishing`,
`share`, `signin` - start the real Worker under `wrangler dev`, and two things
follow from that. They want `CLOUDFLARE_API_TOKEN` in the environment, because
the Worker binds Workers AI and that has no local emulation, so wrangler opens a
remote proxy session for it and cannot without one; nothing the drives do
reaches the AI. The two that hold a socket open, `collaborate` and
`draw-together`, do not start without it; the ones that only make requests have
been seen to carry on. And they bake their own Worker's address into `dist` as
the API, so the runner makes the shared build again after each of them.

A drive whose port something else already holds is reported `blocked` rather
than failed, because that is not the app being wrong.

## The launch

A slow launch can only be measured on the machine that has one: the disk, the
antivirus and the webview runtime are the three biggest terms in it and none of
the three is in this repository. So the app says it itself. Set
`NIB_TRACE_STARTUP` and every launch appends a page to `startup-trace.log` in the
app's log folder - `%LOCALAPPDATA%\ch.emilvinu.nib\logs` on Windows,
`~/Library/Logs/ch.emilvinu.nib` on macOS, `~/.local/share/ch.emilvinu.nib/logs`
on Linux:

```powershell
setx NIB_TRACE_STARTUP 1      # then start Nib the way you always do
setx NIB_TRACE_STARTUP ""     # and off again
```

One page, one launch, two clocks on one axis: the crate's steps from before its
own first line to the window being shown, and the window's own from the page
being requested to the last stage of the launch order. Each line says when it
happened and how long since the line above it, which is the column the answer is
in. `windows, before our first line` is the machine loading the binary, and a
launch whose cost is in that row is not one this code can make faster. See
`apps/desktop/src-tauri/src/trace.rs` and `apps/desktop/src/lib/trace.ts`.

Off costs one environment read and a push onto an array, so there is no build to
make and no flag to pass: the app somebody already has is the app that answers
this.

## Types

Every package extends `tsconfig.base.json`. Beyond `strict`: an index may
miss (`noUncheckedIndexedAccess`), an optional property is not the same as one
set to `undefined` (`exactOptionalPropertyTypes`), overrides say so, switches
do not fall through, parameters nothing reads go. Fix the cause: a check, a
better shape, a narrower type. `!` and `as` are last resorts and each carries a
reason in the line above.

Values crossing a boundary (`invoke`, `JSON.parse`, `fetch`, `localStorage`,
`postMessage`) are unknown until checked. Validate them once, at the
boundary, into a typed shape; the rest of the code trusts the type.

## Lint

The strict and stylistic typescript-eslint sets, plus Svelte's. A promise is
awaited, returned, or dropped with `void`. Every `catch` either handles the
error, reports it to the person (`message(error, ...)`), or says in a comment
why it may be ignored. A disable comment names its reason and is rare.

## Tests

A bug fix ships with a test that failed before it. Pure logic gets unit tests;
routes get harness tests; editor behaviour gets state-level tests without a
DOM where possible. Widgets extend `NibWidget`; a test enforces it.

A test measures the code, not the queue in front of it. Loading a module graph
is seconds of compiling that belongs to no one test, so a file whose hooks
re-import the app's stores imports them once at module scope first: a timeout
that fires is then about the test and not about what else the machine was
doing. For the same reason a state the editor parses is read through
`packages/editor/test/parsed.ts` rather than as it comes, and work a whole
file shares is done once, in a hook.

## Writing

Comments say why, in plain prose, not what the next line already says. No em
dashes anywhere, in code, comments, strings or docs; tests forbid them in the
catalogues. User-facing strings in the editor go through `labels.ts`; in the
app through `t()`; every key is translated in every catalogue.

## Words the reader sees

`apps/desktop/src/lib/i18n.svelte.ts` is the whole mechanism, and
`apps/desktop/src/locales/` holds one catalogue per language. **The English
string is its own key**, so nothing can come out blank: a language that has not
translated a row shows the English.

### Adding a string

1. Write it in English at the call site, through one of four shapes:

   | Shape | For |
   | --- | --- |
   | `t('Save')` | a string translated where it is written |
   | `key('Save')` | a string something further along translates, in a table of rows |
   | `message(error, 'could not reach the server')` | the sentence a failure falls back to |
   | `plural(n, { one: '{count} note', other: '{count} notes' })` | anything a number decides |

2. Add the row to `locales/de.ts`, which is the reference every other catalogue
   is held to, and then to the rest.

`src/lib/i18n.test.ts` is the check: it fails the build when a catalogue is
short of a row, carries one nothing asks for, has the wrong count forms for its
language, loses a placeholder, or holds an em dash. Run it alone with

```sh
pnpm --filter @nib/desktop exec vitest run src/lib/i18n.test.ts
```

Rules the tests enforce:

- **No English in the markup.** `test/localised.test.ts` walks the source and
  fails on a phrase, a `title`, an `aria-label`, a `placeholder`, an `alt` or a
  `label:` that is not an expression. Sample values (`you@example.com`) and
  single glyphs are exempt by name.
- **A count goes through `plural()`**, never through `count === 1 ? … : …`.
  English has two forms, Polish four and Arabic six; which one a number takes is
  `Intl.PluralRules`'s answer. The `other` form is the key the row is filed
  under, and a catalogue holds either one string (a language with one form) or
  exactly the categories `Intl` gives that language.
- **A date, a time or a number goes through `when()` or `amount()`**, which ask
  `Intl` in the app's language rather than the browser's. Never
  `toLocaleString()`: somebody reading a German app on an English machine should
  read German dates.
- **Nothing is concatenated.** One row is one whole sentence with `{placeholders}`
  in it; two halves joined with `+` cannot be reordered by a language that wants
  them the other way round.
- **A sentence the Worker answers with is a row too.** `services/sync` replies in
  English, the client throws it, and `message()` looks the text up like any other
  string. A new `{ error: '…' }` a reader can bring about needs a row in every
  catalogue; the ones a correct client never sends (`send an object`, `not a
  request`) are deliberately left in English.

### Adding a language

1. Add it to `LANGUAGES` and to `CATALOGUES` in `i18n.svelte.ts`, named the way
   its own speakers write it, with `machine: true` unless somebody has read the
   catalogue through. The `CATALOGUES` map is written out entry by entry so the
   bundler and `knip` can both see every file; each catalogue is fetched when it
   is chosen, not at start.
2. Add the tags a system might send it under to `ALSO` where they are not the id
   (`zh-TW`, `tl`, `prs`).
3. Write `locales/<id>.ts`. `node scripts/locale-template.mjs <id>` writes a
   starting file into `target/locale-templates/` with the right rows in the right
   order, the section comments, and every count row already shaped for the plural
   forms that language has. Translate the values and change nothing else.
4. `python scripts/locale-e2e.py --languages <id>` photographs every surface at
   desktop and phone widths and fails on anything the translation cut off that
   the English does not.

Keep one word per term. nib's own vocabulary, and what to follow:

| nib's word | What it is | Precedent |
| --- | --- | --- |
| space | a folder of notes that syncs and is shared as a unit | Obsidian's *vault*, Notion's *workspace*. de `Bereich`, fr `Espace`, ja `スペース` |
| note | one markdown document | Obsidian's *note*, Notion's *page*. de `Notiz`, fr `Note`, ja `ノート` |
| canvas | a board of cards, pictures and ink | Obsidian's *Canvas*. de `Leinwand`, fr `Canevas` |
| room | a live session two people write one note in | the language's word for a collaboration *room* |
| mark | the markdown characters live preview hides | the language's word for a *syntax mark* |
| journal | the dated daily note | Obsidian's *daily note*. de `Tagebuch` |
| theme | a colour scheme | de `Design`, fr `Thème` |

`Nib`, `nibeditor`, format names (`Markdown`, `PDF`, `HTML`), other products
(`Obsidian`, `Notion`, `OpenAI`) and key names (`Ctrl`, `Enter`, `⌘`) are never
translated. The glasses' own words are shown on a 640×200 panel that cannot
scroll, so they must be no longer than the English.

The language setting follows the system by default: the first of
`navigator.languages` the app has a catalogue for, longest tag first, English if
none. `catalogueFor()` is that rule and is tested on its own.

Most catalogues were written in one pass and never read through. The language
row says so and links to the folder, which is the only honest thing to do and
the only way they get better.

## Commits

`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `style:`, `chore:`,
then a short lowercase phrase, one line. Authored by the person committing,
no trailers.
