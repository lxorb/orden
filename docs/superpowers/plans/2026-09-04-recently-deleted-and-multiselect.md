# Recently deleted and multi-select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleted notes and spaces wait 14 days in "Recently deleted" (account-side when signed in, device-side otherwise) and can be restored from a settings section; the tree lets several rows be selected, moved and deleted together.

**Architecture:** The server turns its existing tombstones into a holding area by keeping content and stamping `deleted_at`, adds `/v1/trash` endpoints and a cron purge. The desktop gets a `trash.svelte.ts` store that reads the account trash or the device trash (Rust commands moving files into `Documents/Nib/.trash` with a manifest), a settings section, and a selection model in the workspace store that the tree, the drop targets and the menus consume.

**Tech Stack:** Cloudflare Workers (Hono, D1, R2, cron triggers), Svelte 5 runes, Tauri 2 (Rust `std::fs`), vitest with the existing harnesses.

## Global Constraints

- Retention: 14 days, purge cron `0 3 * * *`.
- Name of the feature in the interface: "Recently deleted" (de "Zuletzt gelöscht").
- Duplicate names on restore take the app's numbering: `Name 2`, `Name 3`, `Name 2.md`.
- Never a commit with `Co-Authored-By`; messages short, one line.
- Every new interface string in all locale files (en default, de, fr, gsw, ja).

---

### Task 1: Server keeps deleted content (`services/sync`)

**Files:** Create `migrations/0011_recently_deleted.sql`; Modify `src/notes.ts` (delete handler), `src/spaces.ts` (delete handler), `src/types.ts` (`deleted_at` on Note and Space); Test `test/trash.test.ts` (new).

**Interfaces:** Produces columns `notes.deleted_at`, `spaces.deleted_at` (integer ms, null when alive or purged). Delete handlers unchanged in signature.

- [ ] Migration: `alter table notes add column deleted_at integer; alter table spaces add column deleted_at integer;`
- [ ] Tests (harness from `test/harness.ts`): after `DELETE /v1/notes/:id` the R2 object still exists and the row has `deleted = 1`, `deleted_at` set, `size`/`hash` unchanged; after `DELETE /v1/spaces/:id` its notes and objects still exist and the space has `deleted_at`.
- [ ] Implement; run `pnpm --filter @nib/sync test`; commit `feat: deleted notes and spaces are kept`.

### Task 2: Listing and restoring

**Files:** Create `src/trash.ts` (Hono router mounted at `/v1/trash` in `src/index.ts`); Test `test/trash.test.ts`.

**Interfaces:** `GET /v1/trash` → `{ spaces: [{ id, name, deletedAt, purgeAt, notes }], notes: [{ id, spaceId, spaceName, path, deletedAt, purgeAt }] }`. `POST /v1/trash/spaces/:id/restore` → `{ space }`. `POST /v1/trash/notes/:id/restore` → `{ note }` or 409 `{ error: 'restore its space first' }`. Helper `freeName(taken: Set<string>, wanted: string)` returning `wanted` or `wanted 2`, `wanted 3`…, and `freePath` doing the same before the extension.

- [ ] Tests: listing shows only the owner's items with `purgeAt = deletedAt + 14d`; a note of a deleted space is not listed separately; restore note → `deleted = 0`, `seq` bumped, appears in `/changes`; restore into a taken path → `Name 2.md`; restore space → alive, at the end of the order, name clash → `Name 2`; refusal when the space is deleted.
- [ ] Implement; tests; commit `feat: recently deleted can be listed and restored`.

### Task 3: Purge

**Files:** Modify `src/trash.ts` (`purgeNote`, `purgeSpace`, `purgeExpired(env, now)`), `src/index.ts` (`scheduled` export), `wrangler.jsonc` (`"triggers": { "crons": ["0 3 * * *"] }`); Test `test/trash.test.ts`.

**Interfaces:** `DELETE /v1/trash/notes/:id`, `DELETE /v1/trash/spaces/:id`, `DELETE /v1/trash` → `{ ok: true }`. `export async function purgeExpired(env: Env, now: number): Promise<{ notes: number; spaces: number }>`.

- [ ] Tests: purge of a note removes the object and leaves the tombstone (`deleted = 1`, `size = 0`, `hash = ''`, `deleted_at = null`); purge of a space removes its notes' rows and objects, keeps the marker; `purgeExpired` with `now = deletedAt + 13d` touches nothing, with `+ 15d` purges; empty purges only the caller's items.
- [ ] Implement; tests; commit `feat: recently deleted purges after 14 days`.

### Task 4: Device trash (Tauri + web fallback)

**Files:** Create `apps/desktop/src-tauri/src/trash.rs`; Modify `src-tauri/src/lib.rs` (register), `src/lib/dev-fixture.ts` (same commands in memory); Test: Rust unit tests in `trash.rs` for manifest + numbering; `src/lib/trash.test.ts` later covers the store.

**Interfaces (Tauri commands):** `trash_item(path: string, kind: 'note' | 'folder' | 'space') -> TrashEntry`, `list_trash() -> TrashEntry[]`, `restore_trash(id) -> { path }`, `purge_trash(id)`, `purge_trash_older_than(ms) -> number`. `TrashEntry = { id, kind, name, from, trashedAt }`. Files live in `Documents/Nib/.trash/<id>/…`, manifest at `.trash/manifest.json`.

- [ ] Implement with `fs::rename` (fallback copy+remove across volumes not needed: same folder tree); numbering on restore when `from` exists; `list_spaces` already skips dot folders.
- [ ] Commit `feat: a device keeps deleted notes for 14 days`.

### Task 5: Desktop store and settings section

**Files:** Create `src/lib/trash.svelte.ts` (store: `items`, `load()`, `restore(item)`, `purge(item)`, `empty()`, `purgeExpired()`), `src/lib/RecentlyDeleted.svelte`; Modify `src/lib/api.ts` (`trash`, `restoreNote`, `restoreSpace`, `purgeNote`, `purgeSpace`, `emptyTrash`), `src/lib/workspace.svelte.ts` (`remove` and `deleteSpace` use `trash_item` when signed out; `restore()` calls `trash.purgeExpired()`), `src/lib/settings.svelte.ts` (`Section` adds `'trash'`), `src/lib/SettingsPanel.svelte` (group entry, mounts the component), locales; Test `src/lib/trash.test.ts`.

**Interfaces:** `TrashItem = { id, kind: 'note' | 'space' | 'folder', name, where, deletedAt, purgeAt, source: 'account' | 'device', spaceId? }`.

- [ ] Tests: signed out, removing a note lands in the device list and restore brings it back to the tree; signed in, the account list is what shows; `purgeExpired` drops device items older than 14 days; empty asks and clears both.
- [ ] Section UI: two groups, rows with Restore / Delete now, Empty at the top with the existing prompt.
- [ ] Commit `feat: recently deleted in settings`.

### Task 6: Selecting several rows

**Files:** Modify `src/lib/workspace.svelte.ts` (`selection: string[]`, `anchor`, `select(path, { toggle, range, order })`, `selectAll(order)`, `clearSelection()`, `isSelected(path)`, `dragPayload(path): string[]`), `src/lib/Tree.svelte` (click modifiers, `.selected`, drag payload `text/nib-paths`, keyboard on the tree container: Ctrl+A, Escape, Delete/Backspace), `src/lib/Sidebar.svelte` and `src/lib/Rail.svelte` (drop handlers accept `text/nib-paths`), menu bulk entries; Test `src/lib/workspace.test.ts` (selection describe block).

- [ ] Tests: toggle adds and removes; range follows the given order from the anchor; select all; plain select replaces; space change clears; `dragPayload` returns the selection when the row is in it, the row alone otherwise.
- [ ] Implement; `pnpm --filter @nib/desktop test` and `check`; browser check on an isolated origin; commit `feat: select several notes with ctrl and shift`.
