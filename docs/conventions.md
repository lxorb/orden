# Conventions

What the code is held to, and how to check it before a commit. CI runs the
same commands on every push to `main`.

## Layout

| Package | What it owns |
| --- | --- |
| `packages/editor` | The CodeMirror 6 live-preview editor: parsing, decorations, widgets, commands. No app concerns. |
| `packages/markdown` | The renderer used for export and publishing. Pure functions from markdown to HTML. |
| `packages/themes` | Design tokens and the stylesheets, shared by the editor, the app and published pages. |
| `apps/desktop` | The Svelte 5 app (stores in `src/lib/*.svelte.ts`, components in `src/lib/*.svelte`), the browser shim in `src/lib/web`, and the Tauri crate in `src-tauri`. |
| `services/sync` | The Cloudflare Worker: sync, publishing, MCP, accounts. Tests run routes against real SQL. |

One file, one responsibility. A file that has to explain two jobs in its
header comment is two files.

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

## Writing

Comments say why, in plain prose, not what the next line already says. No em
dashes anywhere, in code, comments, strings or docs; tests forbid them in the
dictionaries. User-facing strings in the editor go through `labels.ts`; in the
app through `t()`; every key is translated in all four dictionaries.

## Commits

`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `style:`, `chore:`,
then a short lowercase phrase, one line. Authored by the person committing,
no trailers.
