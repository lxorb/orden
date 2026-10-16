# Bug burn-down

Started 2026-10-16 on `claude/bug-burn-down`, from `main`.

## Method

- Baseline: full test suite (`pnpm test`), typecheck (`pnpm check`) and lint
  (`pnpm lint`) on Node 24, the version `.node-version` names. (Node 22 fails two
  Web Locks tests in `src/lib/web/sync-store.test.ts` that pass on 24; that is the
  environment, not a bug.)
- Audit: a read-only pass over the highest-risk areas, each finding traced to a
  concrete input before it was kept: the sync Worker, the Tauri backend's path
  judges, markdown rendering and the trust rule, sync-core / rooms / chats /
  online, the workspace store, bases and the editor's commands, and the machine
  service, the clipper, the CLI and CI.
- Each bug: reproduced with a failing regression test, root cause named, fix, then
  the package's tests, typecheck, prettier and eslint re-run. One commit per bug.

Severity: **Critical** - cross-user exposure, code execution or broad silent
data loss. **High** - data loss or a security hole on a specific path.
**Medium** - wrong behaviour in normal use. **Low** - cosmetic or a rare edge.

## Summary

| Severity | Found | Fixed | Open |
| --- | --: | --: | --: |
| Critical | 1 | 1 | 0 |
| High | 9 | 3 | 6 |
| Medium | 20 | 12 | 8 |
| Low | 7 | 5 | 2 |

Open rows are being fixed; see the status column.

## Bugs

| # | Severity | Bug | Status | Root cause | Fix | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Critical | `PUT /v1/blobs/:hash` stored any bytes under any hash, replacing the one object every account with that hash is served: stored XSS on published sites via `/i/<hash>.js`, defaced pictures | Fixed `caf8bdfb` | The route took the hash in the path on trust and always wrote `blobs/<hash>` | Bytes are hashed and must be the name; the one exception (a drawn diagram, named by fence and unprinted space id) is never written over an object already there; a verified upload repairs an object that is not its name | `blobs.test.ts` "bytes under a hash that is not theirs" (4 tests, 2 failed before); sync suite 2052 passed; tsc, eslint, prettier clean |
| B2 | High | A failed multipart upload could leave junk under another account's file | Fixed `78c9095c` | Parts were put together at `blobs/<hash>` itself; whether a copy existed was asked only at the start | Parts go to `uploads/<hash>/<uuid>`, are measured and hashed, then copied into place only if no copy is there | `sync2-files.test.ts` "never over a copy finished meanwhile" (failed before); sync suite passed |
| B3 | High | Running `release.yml` by hand on any branch replaced the signed `edge` release, which edge installs update to | Fixed `f7158d4b` | `build-version.sh` makes every non-tag ref `edge`, and `publish` had no ref guard | `publish` runs only for `main` or a `v*` tag, as `publish-mobile.yml` does | `packaging.test.ts` "publishes only from main or a tag" (failed before), "and no other job writes" |
| B4 | Medium | Knowing a hash was enough to read a non-image file | Fixed `a2425ab0` | Starting a multipart upload for a hash someone held wrote a `blobs` row with no bytes; an SVG under a held diagram name did the same | The upload is sent in full and the row follows the check; an unverified SVG under a held name is refused. (Chat posts were already checked by `holds`, which is sound once a row means bytes.) | `sync2-files.test.ts` "sent in full even when somebody else already keeps them", `blobs.test.ts` diagram row assertion (both failed before) |
| B5 | Medium | A v1 save renaming a note onto a taken path, or reviving a deleted note over a new one, answered 500 | Fixed `6969078c` | No occupancy check before the update; the unique index threw | Same 409 and note as a create, from a read before the write and from a caught race | `sync.test.ts` "a save that moves a note onto another one is told it is there", "…brings a deleted note back over a new one" (500 before) |
| B6 | Medium | A watcher who may not type restarted the owner's ended shell by opening or reconnecting | Fixed `8c120fa6` | `hello` called `ensureOpen` for every viewer and nibd restarts a dead session on `open` | `ensureOpen` skips an ended session for a viewer who may not type; `reopen` prefers a typist | `machines.test.ts` "a watcher arriving on an ended session does not start it again" (failed before); 82 passed |
| B7 | Medium | A 52-90 ms long task at launch after `rooms may start`; `smoke` red on every PR | In progress | - | - | `long-tasks.py` fails 3/3 on `main` here, and on CI |
| B8 | Low | `orden … --content -h` printed help and exited 0; a bare `--` was a flag | Fixed `9be7f400` | `main` read the raw argv for `-h` | Help only where a flag goes; `--` ends flags | `cli-args.test.ts` (2 new, failed before) |
| B9 | High | `merge3`'s "both" settle dropped both sides' insertions at one point (silent text loss on canvas/page cards) | Fixed `6c67fb97` | `both()` looped `at < to`, so insertions keyed at `to` were never written | Loop to `at <= to`, writing the ancestor char only while `at < to` | `merge3.test.ts` "one passage written twice at one point, settled both ways, keeps both" (failed before); sync-core 196 passed |
| B10 | Medium | Offline mkdir → move a note in → delete the folder: the note's delete was never sent | Fixed `0bf2b007` | `coalesce` emits split deletes `<op>.0…`; `sendOps` only rewrote existing rows | Split ops get rows of their own at the original delete's place | `engine.test.ts` "a note moved into a folder made and deleted here is deleted on the account too" (failed before) |
| B11 | Low | Device names blank for a whole session if the first lookup failed | Fixed `3758894b` | Empty map cached before the request, kept on failure | One shared in-flight promise, cached only on success | `signing-out.test.ts` "is asked for once by everyone who wants it at once, and a failure is not kept" |
| B12 | Medium | Windows built in Rust kept Tauri's drop handler: a drop widened the `chosen` write scope to the dropped file's folder, and HTML5 drops stopped working | Fixed `6d1deb3e` | Six `WebviewWindowBuilder`/`WebviewBuilder`s lacked `.disable_drag_drop_handler()`; Tauri's drop emits `PathAllowed`, which `hear_picks` takes as a pick | Disabled in all six (launch, quick add, pdf, web-tab popup, extensions control, engine gate) | `launch::tests::every_webview_takes_its_own_drops` (named six files before); 45 cargo tests passed |
| B13 | Medium | A monthly task ~a year overdue skipped months when ticked | Fixed `c2163373` | `periodsBetween` assumed 28-day months and overshot; `nextDate` never walks back | Longest unit lengths (31/366 days) so the guess can never overshoot | `recurrence.test.ts` "the next date" rows, `occurrence.test.ts` "a monthly task years overdue…" (failed before); bases 787 passed |
| B14 | Medium | `every 2 years on 3 March` was written in a form `parseRule` could not read, so the task stopped recurring | Fixed `0c396fe2` | Writer emits `every N years in <month>`; reader did not accept `in` | Reader accepts `in` + months after a year unit | 36-rule round-trip test (12 failed before) |
| B15 | Medium | A view's unreadable `filters` and string `limit` were dropped from a `.base` on save | Fixed `72e9d326` | Kept nowhere when `readFilter` returned null | Raw values kept in `view.options` and written back | `base-file.test.ts` "a view's filters and limit nib cannot read stay as written…" |
| B16 | Medium | Bullet list over a mixed selection flattened nesting; turning it off left `[ ] ` | Fixed `e3fa2c1d` | The marker pattern's `^\s*` took the indent with it | Keep the indent; strip a task box with the marker | 2 tests in `commands.test.ts` (failed before); editor 1572 passed |
| B17 | Medium | Table sort read `Room 5` as 5, and mixed columns sorted inconsistently | Fixed `8e12cf62` | `numberIn` stripped any leading text; comparator not a total order | Strip only currency/whitespace; compare by kind first | 2 tests in `model.test.ts` |
| B18 | Medium | Editing a task field written twice changed the copy that is not read | Fixed `4e8f5ab9` | Reader keeps the last copy, writer edited the first | Edit the last; clearing removes every copy | `task-edits.test.ts` "of a field written twice is made to the one that is read" |
| B19 | Medium | Moving a bracket date erased the time after it | Fixed `35b417e2` | The token's value span covered the whole value, the reader only 10 chars | Value span ends where the date does | `task-line` test "…moves the date and keeps the time" |
| B20 | Low | Removing a tag written twice left one copy | Fixed `895d8c3c` | `find` took one match | Every copy removed, as one edit where adjacent | `task-edits.test.ts` "takes off a tag written twice…" |
| B21 | Low | Task list over `> c` gave `- [ ] > c` | Fixed `89fe1dd4` | The quote marker was read as words | Read after the quote prefix | `commands.test.ts` "puts the box inside a quote…" |
| B22 | Low | A date with no year took UTC's year near New Year | Fixed `f56407e9` | `new Date().toISOString()` | Local `todayOf()` | `todoist.test.ts` (Pacific/Auckland, fake clock) |
| B23 | High | Saving a draft into a space not on screen overwrote an existing note there | In progress | `freeName` checks only the space on screen | - | - |
| B24 | High | Undoing a delete overwrote a note made at the same path since | In progress | `putBack` writes without checking the path | - | - |
| B25 | High | Moving a file or renaming a folder during an autosave left the file in two places | In progress | `move`/folder `rename` not held; `written()` resets `path` | - | - |
| B26 | Medium | The heading rewritten after a rename was never saved | In progress | `replace(…, note.dirty)` is quiet for a clean note | - | - |
| B27 | Medium | A link rewrite was lost when the linking note had unsaved typing | In progress | `retarget` rewrites the disk copy; the dirty document writes the old link back | - | - |
| B28 | Medium | Convert syntax could overwrite a change made during its confirm dialog | In progress | Closed notes written from text read before the dialog | - | - |
| B29 | High | A file shared with you on its own rendered its raw HTML as your own | In progress | `originOfDocument` ignores `note.shared` when `path` is null | - | - |
| B30 | High | Export and print never asked the trust question, and the hidden-window outputs have no CSP | In progress | `buildBody` never passes `escapeHtml` | - | - |
| B31 | High | Pasting or clipping HTML collapsed blank lines and stripped trailing spaces inside code blocks | In progress | `tidy()` runs over fenced code | - | - |
| B32 | Medium | `<br>` lost converting HTML to markdown | In progress | Same `tidy()` strip removes turndown's hard break | - | - |
| B33 | Medium | `$` patterns in a heading or embed were interpreted by `String.replace` | In progress | Rendered HTML used as a replacement string | - | - |
| B34 | Medium | An HTML block starting with `<iframe` dropped what followed in the block | In progress | The whole block replaced by the card | - | - |
| B35 | Medium | ```` ```flow ```` fences could carry `javascript:` links and window-global click hooks | In progress | flowchart.js `:>url` and `:$name` | - | - |
| B36 | Low | `&#106avascript:` passed the trusted-HTML filter | In progress | Decimal branch of the entity regex eats hex letters | - | - |
| B37 | Low | An abbreviation could be wrapped inside an entity | In progress | Skip pattern lacked entities | - | - |

Not fixed, judged insignificant or out of scope: GFM's escaped backslash before a
pipe in tables (text written back unchanged); Todoist `date before: Oct 6, 2026`
(the comma splits the filter; unclear Todoist accepts it); NFC/NFD names treated as
one file on ext4 (not reproduced).
