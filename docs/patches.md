# Patched dependencies

Bugs in a dependency are fixed in place with `pnpm patch` rather than waited
for upstream or worked around in our code. Each fix is one patch file in
`patches/`, listed under `pnpm.patchedDependencies` in the root `package.json`;
`pnpm-lock.yaml` records each patch's hash, so `pnpm install --frozen-lockfile`
fails if a patch file and the lockfile disagree. We don't file issues or pull
requests upstream.

| Package | Patch | What it fixes | Tests |
| --- | --- | --- | --- |
| `marked` 18.0.11 | `patches/marked@18.0.11.patch` | `emStrong` no longer walks the paragraph for emphasis nothing can close, and stops 32 deep (#547, #549) | `packages/markdown/src/emphasis.test.ts` |
| `@lezer/markdown` 1.7.2 | `patches/@lezer__markdown@1.7.2.patch` | Links and addresses in a huge paragraph parse in linear time (#529) | `packages/editor/src/markdown/extensions.test.ts` |

Only the file the app loads is patched: `lib/marked.esm.js`, which marked's
`exports` gives for `import 'marked'` (the app, vitest and the sync worker all
load it), and `dist/index.js` of `@lezer/markdown`. `lib/marked.esm.js` is
minified, so the patch appends its code after the last line and replaces
`Tokenizer.prototype.emStrong` from there; it calls the class by its minified
name, which the file's `export{... y as Tokenizer ...}` gives.

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
