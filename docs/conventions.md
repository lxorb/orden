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
| `services/sync` | The Cloudflare Worker: sync, publishing, MCP, accounts, and the theme store's catalogue. Tests run routes against real SQL. A published page is the note; see `docs/publishing.md`. |

One file, one responsibility. A file that has to explain two jobs in its
header comment is two files.

## Security

A note is a file, and a file can come from anywhere: a download, a repository,
a folder somebody shared. Three rules follow, and none of them is widened
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

The policy that backs all three is `apps/desktop/src/csp.ts`, which is the one
copy of the app's `Content-Security-Policy`: the Tauri config, `index.html` and
the dev server all carry it and `apps/desktop/test/csp.test.ts` holds them to
each other. Two lines in it are load-bearing. `script-src-attr 'none'` is why
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
dictionaries. User-facing strings in the editor go through `labels.ts`; in the
app through `t()`; every key is translated in all four dictionaries.

## Commits

`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `style:`, `chore:`,
then a short lowercase phrase, one line. Authored by the person committing,
no trailers.
