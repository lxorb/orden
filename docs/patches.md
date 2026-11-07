# Patched dependencies

Bugs in a dependency are fixed in place with `pnpm patch` rather than waited
for upstream or worked around in our code. Each fix is one patch file in
`patches/`, listed under `pnpm.patchedDependencies` in the root `package.json`;
`pnpm-lock.yaml` records each patch's hash, so `pnpm install --frozen-lockfile`
fails if a patch file and the lockfile disagree. We don't file issues or pull
requests upstream.

| Package | Patch | What it fixes | Tests |
| --- | --- | --- | --- |
| `marked` 18.0.11 | `patches/marked@18.0.11.patch` | `emStrong` no longer walks the paragraph for emphasis nothing can close, and stops 32 deep (#547, #549); `link` reads a destination once, 32 parentheses deep at most, and a title in parentheses ends at another opening one, as cmark does (#1292); the text rule reads where an address could start once per paragraph, an opener's run is read off the runs, and lists and quotes are read 100 deep (#1515) | `packages/markdown/src/emphasis.test.ts`, `packages/markdown/src/links.test.ts`, `packages/markdown/src/runs.test.ts` |
| `turndown` 7.2.4 | `patches/turndown@7.2.4.patch` | Each child's Markdown is joined as a part of a list, not onto one growing string whose end is read again for every child, so a long pasted page converts in time that grows with its length (#1349) | `packages/markdown/src/from-html.test.ts` |
| `@codemirror/view` 6.43.11 | `patches/@codemirror__view@6.43.11.patch` | Reading back what was typed counts the positions of a line's tiles once, not once per hidden mark (#1305); a replaced range that starts under a replaced range of higher precedence, as a long line's gap under a hidden mark, is drawn instead of being added to the other one's tile (#1332); a press in the selection whose first move is 10 px away waits for the browser's drag before selecting, so the words selected are dragged (#1336); an update of many transactions composes their changes in pairs, not each onto the growing whole (#1527) | `packages/editor/src/long-line-typing.test.ts`, `packages/editor/src/covered-widget.test.ts`, `packages/editor/src/drag-start.test.ts`, `packages/editor/src/batch-update.test.ts` |
| `@codemirror/language` 6.12.4 | `patches/@codemirror__language@6.12.4.patch` | A transaction annotated `parseLater` leaves the parse to the next one without it, which takes the changes since, so a batch of edits parses once (#1527); a mixed parse whose time runs out in its outer language is stopped where that has read to, not at 0, so the block it just read is not read again (#1557); one whose outer language read the whole note keeps that tree as a closed fragment when only its inner parses are stopped, so the last block is not read again either (#1584) | `packages/editor/src/batch-update.test.ts`, `packages/editor/src/markdown/stopped-parse.test.ts` |
| `@codemirror/commands` 6.11.0 | `patches/@codemirror__commands@6.11.0.patch` | A run of joined history events composes its changes only when read, in runs that halve, so joining n edits takes n log n time and memory, not n squared (#1527) | `packages/editor/src/batch-update.test.ts` |
| `@replit/codemirror-vim` 6.4.0 | `patches/@replit__codemirror-vim@6.4.0.patch` | A vim operation gathers its transactions and dispatches them at its end as one update (#1423); the states between its first and its last leave the parse for later, so a command over every line parses once (#1527) | `packages/editor/src/vim-keys.test.ts` |
| `@lezer/markdown` 1.7.2 | `patches/@lezer__markdown@1.7.2.patch` | Links and addresses in a huge paragraph parse in linear time (#529); a destination is read 32 parentheses deep at most, a title in parentheses ends at another opening one, and a closer nothing opens is looked back for once, as cmark's `openers_bottom` (#1292); lists and quotes are read 100 deep, as marked reads them (#1515); a `]` looks back for its `[` only as far as the last one that found none (#1519); an inline parser may name the characters it starts at (`triggers`) and is asked only there, and an address is looked for only where an `@` is at most a hundred characters on (#1557) | `packages/editor/src/markdown/extensions.test.ts`, `packages/editor/src/markdown/inline-triggers.test.ts` |
| `@lezer/common` 1.5.2 | `patches/@lezer__common@1.5.2.patch` | A mixed parse that checks the nodes of a new block against the old tree moves past a buffer it cannot enter, instead of reading the block's children from the first again at every node (#1557); an inner parse that was stopped is mounted as open at its end, so a later parse never takes its last node as finished (#1584) | `packages/editor/src/markdown/stopped-parse.test.ts` |

Only the file the app loads is patched: `lib/marked.esm.js`, which marked's
`exports` gives for `import 'marked'` (the app, vitest and the sync worker all
load it), `dist/index.js` of `@lezer/markdown` (and its types) and `@codemirror/view`, `dist/index.js` and `dist/index.cjs` of `@lezer/common`, `@codemirror/language`, `@codemirror/commands` and `@replit/codemirror-vim`, and of turndown `lib/turndown.browser.es.js` (the app) and `lib/turndown.cjs.js` (vitest). `lib/marked.esm.js` is
minified, so the patch appends its code after the last line and replaces
`Tokenizer.prototype.emStrong`, `link`, `inlineText`, `list` and `blockquote` from there; it calls the class by its minified
name, which the file's `export{... y as Tokenizer ...}` gives. One minified line is changed too: the lexer
hands `inlineText` and `url` what is left of the paragraph and the list it fills (`inlineText(u,e,t)`, `url(e,t)`),
so a rule can read the paragraph once rather than at every character.

## Updating a patched package

1. Bump the version in every `package.json` that names the package, and in the
   key of its `pnpm.patchedDependencies` entry.
2. `pnpm patch <package>@<new version>`, and make the same change in the
   directory it prints. For marked, append the block from the old patch and
   change `y` to the new build's name for `Tokenizer`.
3. `pnpm patch-commit <that directory>`, then delete the old patch file.
4. For marked, cut the hunk's context down to the `//# sourceMappingURL` line,
   since every other line around it is kilobytes of minified code (`@@ -N +N,M @@`
   with `N` the last line of the file), and run `pnpm install` to record the new
   hash. Keep only the patch's own changes in `pnpm-lock.yaml`.
5. Run the tests in the table, and the checks in `docs/conventions.md`.

If a release fixes the bug itself, drop the patch and its entry instead.

## Upstream releases

A patch pins the exact version, so nothing moves the package forward on its
own. Watch its releases and security advisories, and update when one fixes a
security bug. If a patch grows large, move to a vendored fork in `packages/`:
the patch file shows exactly what to carry over.
