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
| High | 11 | 11 | 0 |
| Medium | 21 | 21 | 0 |
| Low | 8 | 8 | 0 |

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
| B7 | Medium | A 52-90 ms long task at launch after `rooms may start`; `smoke` red on every PR | Fixed `53cd7d68` | It was the doors stage: `warmDoors()` started ~36 dynamic imports in one task, and Vite's preload helper scanned every `<link>` and appended a modulepreload per new dependency for each | `knock()` starts each door after `breathe()`, so each import's preload work is its own task; failures still reject the whole | `long-tasks.py` same machine, interleaved: without the fix 4/4 failed (73-138 ms at the doors mark), with it 4/4 passed; profiles before 130-163 ms at doors, after none. A separate 60-120 ms left-panel flush under heavy load predates this and was not seen on CI |
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
| B23 | High | Saving a draft into a space not on screen overwrote an existing note there | Fixed `e0baa3cb` | `freeName` checks only the space on screen | `Saving.claim` asks the disk about each name and claims it in the same step | `written-over.store.test.ts` "steps past a note of the same name" (failed before) |
| B24 | High | Undoing a delete overwrote a note made at the same path since | Fixed `aabc4970` | `putBack` writes without checking the path | `writeBeside` steps a taken name aside, like the trash restore | `written-over.store.test.ts` "puts the old note back beside the new one" (failed before) |
| B25 | High | Moving a file or renaming a folder during an autosave left the file in two places | Fixed `9fa45386` | `move`/folder `rename` not held; `written()` resets `path` | `holdingUnder` holds every document under the path; `written()` keeps a moved path and re-queues | 3 `file-ops.store.test.ts` tests with `write_note` held open, `saving.test.ts` (failed before) |
| B26 | Medium | The heading rewritten after a rename was never saved | Fixed `5f9de58b` | `replace(…, note.dirty)` is quiet for a clean note | The note is marked dirty and owed a write after the rename | `file-ops.store.test.ts` "has the new heading written to the file" (failed before) |
| B27 | Medium | A link rewrite was lost when the linking note had unsaved typing | Fixed `73854b3e` | `retarget` rewrites the disk copy; the dirty document writes the old link back | An open note is rewritten in its document, then written | `file-ops.store.test.ts` "keeps both the typing and the new link" (failed before) |
| B28 | Medium | Convert syntax could overwrite a change made during its confirm dialog | Fixed `bcd017c9` | Closed notes written from text read before the dialog | `writeClosed` re-reads; edits move past a changed span, overlap leaves the note alone | 3 `note-text.test.ts` tests (failed before) |
| B29 | High | A file shared with you on its own rendered its raw HTML as your own | Fixed `dc51542d` | `originOfDocument` ignores `note.shared` when `path` is null | A file opened from a share counts as shared whatever its path | `markdown-trust` test for a shared file with no path (failed before) |
| B30 | High | Export and print never asked the trust question, and the hidden-window outputs have no CSP | Fixed `4b4ca0c1` | `buildBody` never passes `escapeHtml` | `buildBody` passes the trust answer; export and print pages carry a CSP meta | export tests for untrusted HTML and the CSP meta (failed before) |
| B31 | High | Pasting or clipping HTML collapsed blank lines and stripped trailing spaces inside code blocks | Fixed `80c499a7` | `tidy()` runs over fenced code | `tidy()` skips fenced code | html-to-markdown test with blank lines and trailing spaces in a fence (failed before) |
| B32 | Medium | `<br>` lost converting HTML to markdown | Fixed `656411db` | Same `tidy()` strip removes turndown's hard break | Hard breaks kept through `tidy()` | `<br>` round-trip test (failed before) |
| B33 | Medium | `$` patterns in a heading or embed were interpreted by `String.replace` | Fixed `c5297762` | Rendered HTML used as a replacement string | Replacement passed as a function | heading and embed tests with `$&` and `$1` (failed before) |
| B34 | Medium | An HTML block starting with `<iframe` dropped what followed in the block | Fixed `9c9f1a7f` | The whole block replaced by the card | Only the iframe tag becomes the card; the rest of the block renders | iframe-block test (failed before) |
| B35 | Medium | ```` ```flow ```` fences could carry `javascript:` links and window-global click hooks | Fixed `11c4e771` | flowchart.js `:>url` and `:$name` | `flow.ts` strips links that are not http(s)/mailto and drops click hooks before flowchart.js sees them | `flow.test.ts` (failed before) |
| B36 | Low | `&#106avascript:` passed the trusted-HTML filter | Fixed `39946245` | Decimal branch of the entity regex eats hex letters | Decimal and hex branches split in the entity regex | trusted-HTML filter test for `&#106avascript:` (failed before) |
| B37 | Low | An abbreviation could be wrapped inside an entity | Fixed `6fab63d4` | Skip pattern lacked entities | Entities added to the skip pattern | abbreviation test (failed before) |
| B38 | High | An exported slide deck rendered a collaborator's HTML live and carried no CSP | Fixed `2c246de8` | `renderDeck` always passed `trusted = true`; `buildDeckHtml` wrote no CSP | The deck takes the note's trust answer and carries a CSP whose `script-src` allows only the deck's own nonced script | `slides/file.test.ts` trust and content-policy tests (5 failed before) |
| B39 | High | Canvas SVG and PDF export rendered every card's HTML as trusted | Fixed `d1d8d1f2` | `cardBody`/`shapeWords` hard-coded `cardHtml(..., true)` | `canvasSvg`/`Drawing` take the plane's trust answer, default untrusted | new `canvas/picture.test.ts` (failed before); canvas, export and commands suites 1016 passed |
| B40 | Medium | Clearing or replacing filters or a limit nib could not read brought the old value back, and new base filters were overwritten by kept ones | Fixed `15cda349` | Kept raw values never removed on edit; `base.kept` spread after the new filters | Edits drop the kept value; `basePlain` writes `filters ?? kept.filters` in place | 8 tests in `base-file.test.ts`, `agent.test.ts`, `views/logic.test.ts` (failed before) |
| B41 | Low | Removing a tag and a field side by side left a doubled blank | Fixed `ac1a3a04` | Tags and fields built separate removals claiming the same blank | All spans go through one `removals()` merge | `task-edits.test.ts` 4 cases (failed before) |

Not fixed, judged insignificant or out of scope: GFM's escaped backslash before a
pipe in tables (text written back unchanged); Todoist `date before: Oct 6, 2026`
(the comma splits the filter; unclear Todoist accepts it); NFC/NFD names treated as
one file on ext4 (not reproduced).
