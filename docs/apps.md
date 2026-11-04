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

## The host (step 3)

- **What this computer has installed** (`apps_host/installed.rs`): on Linux the desktop entries
  of the XDG data folders, read as the Desktop Entry Specification says (the first folder with
  an id wins; hidden entries, entries not shown in menus, terminal programs and entries whose
  `TryExec` is missing are left out), with their icons from the hicolor theme or `pixmaps`; on
  Windows the Start menu's shortcuts; on a Mac the bundles in `/Applications` and
  `~/Applications`.
- **The catalogue**: the host writes that list to the account, `PUT /v2/apps/catalogue`, for its
  own device (the session's, never one the request names), and any of the reader's devices reads
  it, `GET /v2/apps/catalogue/:device` (`services/sync/src/apps/catalogue.ts`, the table
  `app_catalogues`). Behind the door's switch; gone with the device when it is ended and with
  the account. **New application** offers it by name and icon (this computer's own list is asked
  of the crate directly), with **Another program…** for a path.
- **Hosting** (`apps/desktop/src/lib/apps/host.svelte.ts`): in developer mode, signed in, on a
  desktop, every application file of the open space that names this device gets a socket to its
  relay as the host. The holder's Start, Stop and Restart are done by the crate
  (`apps_host.rs`), and where the application stands is said back, with a reason when it did
  not start (`why`: `isolation`, `display`, `refused`, `missing`, `failed`). Nothing starts by
  itself; an application keeps running when its viewer leaves and when the host's window
  reloads, and stops when it is stopped, when its file goes and when Orden quits.
- **What may run**: an installed application by the id the crate found and the command its own
  entry holds; a program by its path only after the reader at the host said yes to that exact
  program, arguments and folder in a dialog of the system's own, remembered in the app's local
  data (a file `allowed.json` in its `apps` folder).
- **Where**: on Linux, an Xvfb of its own (`apps_host/display.rs`) at the holder's size in
  device pixels, with the toolkits told to speak X11 (`WAYLAND_DISPLAY` removed), in a process
  group of its own that is what Stop ends. Xvfb not installed: the tab says so. Windows and
  macOS: nothing is started, and the tab says the computer cannot give an application a
  display of its own yet (step 8).
- **Not yet**: a host serves the applications of the space it has open; a program that speaks
  only Wayland needs a headless compositor (weston), which comes with the capture in step 4.

## The picture (step 4)

- **The host sends it** (`apps_host/stream.rs`): the holder offers a receive-only video and a
  data channel, and the host answers, peer to peer. The signalling is the relay's `signal`
  frames, whose `data` is JSON: `{"offer": sdp}` and `{"candidate": {...}}` from the holder,
  `{"bye": true}` when it is done; `{"answer": sdp}` with every host candidate in it, or
  `{"cannot": "encoder" | "offer" | "network" | "stopped"}`, from the host. The window hands
  them to the crate (`apps_signal`) and says its answer back; a new holder, or none, ends the
  picture the last one had. No server change: the relay already passes `signal` between the
  holder and the host only.
- **`str0m`**, WebRTC with no threads or sockets of its own, its DTLS and SRTP in RustCrypto (its certificate made with aws-lc-rs, built from source):
  one UDP socket for each address the host has (and the loopback), a thread for each, one for
  its timers. It gathers nothing and has no TURN client; the host needs none, since the
  viewer's engine does TURN.
- **ffmpeg**, a program the host runs as it runs Xvfb: `x11grab` reads the display, libvpx
  encodes VP8 in its realtime mode with no frame held back, and each frame is written to a
  pipe as IVF the moment it is made. VP8 because every viewer's engine decodes it (Orden's
  CEF has no H.264). It starts once the viewer is connected, so the first frame is a key
  frame; another comes every two seconds. Not installed: the viewer is told `encoder`.
- **The tab shows it** (`apps/desktop/src/lib/apps/picture.svelte.ts`): while this device holds
  the application and it runs on a host that is there, the engine's own `RTCPeerConnection`
  offers a receive-only video and the data channel `input`, trickles its candidates, and shows
  the host's track in a `<video>` over the pane, with Restart and Stop at its corner. A
  connection that fails, or is not answered within 20 seconds, is tried again after 4 while it
  is wanted; a host that says why it has none is not asked again until the picture is wanted
  afresh. The tab says the picture cannot reach this device, that the host needs ffmpeg, or
  that this engine has no WebRTC. Another device taking it over ends the picture here, and the
  host is told (`bye`).
- **Input goes back** over the data channel (`apps/desktop/src/lib/apps/input.ts` in the tab,
  `apps_host/input.rs` on the host): the pointer at a point of the display in its own pixels
  (through the scale and the bands the picture is drawn with), buttons, the wheel in clicks (a
  notch, or three lines, a click), and keys by the character they gave and the key they were.
  The host plays them with XTEST into the application's Xvfb and nowhere else: a key on the
  key of the display's keymap that gives its keysym with Shift as held, or on a spare key lent
  it, so the holder's layout decides what is typed; what was pressed is what is let go, and
  everything held is let go when the picture ends. `AltGraph` is not passed on, since the
  character it chose is. Input methods, touch, pen and precise scrolling are step 5.
- **Across networks**: the host asks Cloudflare's STUN, once for each of its sockets, what
  address the internet sees it at (`apps_host/stun.rs`), and puts that in the answer beside its
  own; the viewer asks the account for its servers, `GET /v2/apps/ice`
  (`services/sync/src/apps/ice.ts`, behind the door's switch): Cloudflare's STUN, and TURN with
  credentials that last a day where the Worker has a TURN key (the secrets `TURN_KEY_ID` and
  `TURN_KEY_TOKEN`). Only the viewer relays; the host answers a relayed candidate from its own
  address. An older account answers 404, and the viewer makes do with the STUN.
