# Applications

Issue 1063, lxorb: a desktop application running on one of the reader's devices, used as an
Orden tab from any other, one device at a time, and driven by an agent as the reader drives
it. Developer mode only. The step plan is on the issue; this says what has landed.

## The relay (step 1)

- **`AppRelay`** (`services/sync/src/apps/relay.ts`) is a hibernating Durable Object, one per
  application, named by its owner and its file's id. Every party has one socket to it at
  `GET /v2/apps/:app/socket` (`services/sync/src/apps/door.ts`): the **host**, the device the application runs
  on, naming itself `nib.role.host`, and the **viewers**, every device with the tab open.
- **Only the reader's own**: the file must be in a space the person owns and not deleted, and
  only their signed-in devices come in. While `apps` is not `on` in `online_service`, or where
  the `APPS` binding is absent, the door answers 404.
- **The lock is the online terminal's** (`services/sync/src/locks/`, docs/online-terminal.md
  4.17): the same rules, the same frames (`hello {hold}`, `take`, `leave`, `held`, `hold`),
  the same grace and quiet times. Two Take overs at once end with one holder.
- **Signalling only**: the holder's `signal` (WebRTC offers and ICE candidates), `view` (the
  tab's size, pixel ratio and refresh rate) and `run` (start, stop, restart) reach the host,
  and the host's `signal` reaches the holder; nobody else's goes anywhere. The picture and the
  input go between the two directly. The host is told who holds the application whenever
  that changes (`viewer`), and that device's view.
- **The host's presence** is its socket: viewers are told `host {up}` as it comes and goes, and
  `state` (stopped, starting, running, exited) is kept for whoever joins later. A second host
  socket replaces the first. The application never stops because a viewer left.
- The wire is `@orden/online/apps`.

## The file and the tab (step 2)

- **An application is a file**, `GIMP.application`: one line of JSON, the device it runs on
  (`host`, the account's device id) and what it runs (`run`: an installed application's id and
  name, or a program's path, its arguments and the folder it starts in). Read strictly, as an
  online terminal's `.term` is (`appFileOf` in `@orden/online/apps`). Its own word rather than
  `.app`, which is a folder on a Mac.
- **Listed like every kind a tab can hold**: `is_application` in the crate's `tree.rs`, `listed`
  in `web/commands.ts`, the `application` opener, its mark (a window), and
  `web/commands.test.ts`'s list of one file of every opener. Synced as a file. In the sidebar only
  in developer mode (`shownTree` in workspace.svelte.ts); elsewhere it is kept and synced, and
  has no row.
- **Made** from the new tab's card, **New application** (A), in developer mode
  (`apps/desktop/src/lib/apps/make.ts`): which of the reader's computers it runs on (Linux, Windows, macOS), then a
  program line, split as a shell splits it and never run by one (`programOf`).
- **The tab** (`apps/desktop/src/lib/apps/ApplicationTab.svelte` and `session.svelte.ts`) reads the file, asks
  sync for its id, and keeps a socket to the relay (`apps/desktop/src/lib/apps/link.ts`, which is the online
  terminal's `Channel` with the application's frames). It says where the application stands -
  waiting for its computer, running on it, not running, or held by another device with Take over
  - with Start, Stop and Restart. The picture comes with the host and the stream (steps 3 and 4).
