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
- **It never waits without saying why.** A page cannot read why a socket was refused, so
  before it opens one the tab looks at the door: the socket's address asked as a plain request,
  the token as a bearer, which answers 426 where the socket may open, 401 signed out, 404 with
  `UNKNOWN_APP` for a file not on the account yet, and a plain 404 where the account serves no
  applications (an older server, or the switch off). Each is its own line in the tab: sign in, the
  file still syncing (looked at again by itself), the server not running applications yet, or not
  reached (tried again). Before that, sync's id for the file (`idAt` in sync2/runner.svelte.ts,
  asked of the window running sync where this one does not) comes with the reason it is missing,
  each its own line: sync not started here yet, the file not taken in yet (both looked for again
  by itself), the file in a space that does not sync (with Sync settings), or the account still on
  sync v1. A file in a space shared with the reader says an application runs only from a space of
  their own, since the door answers only its owner. A socket that does not open within 12 s says it cannot reach the server
  and looks again; a host the account no longer lists is said to be gone; Start, Stop or Restart
  the host does not answer within 15 s is said too. A host makes no socket to an account that
  serves none, and a computer that cannot run an application at all says so before anybody
  presses Start (`cannot` in `host.svelte.ts`).

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
  not start (`why`: `isolation`, `display`, `permission`, `refused`, `missing`, `packaged`, `handed`, `failed`). Nothing starts by
  itself; an application keeps running when its viewer leaves and when the host's window
  reloads, and stops when it is stopped, when its file goes and when Orden quits.
- **What may run**: an installed application by the id the crate found and the command its own
  entry holds; a program by its path only after the reader at the host said yes to that exact
  program, arguments and folder in a dialog of the system's own, remembered in the app's local
  data (a file `allowed.json` in its `apps` folder).
- **Where**: on Linux, an Xvfb of its own (`apps_host/display.rs`) at the holder's size in
  device pixels, with the toolkits told to speak X11 (`WAYLAND_DISPLAY` removed), in a process
  group of its own that is what Stop ends. Xvfb not installed: the tab says so. Windows and
  macOS each have a display of their own (step 8, below).
- **Not yet**: a host serves the applications of the space it has open; a program that speaks
  only Wayland needs a headless compositor (weston), which comes with the capture in step 4.

## What a computer has installed, with icons

- **Every one**, as the system's own list shows them, each with its own icon made 32 pixels
  across (`apps_host/installed.rs`, `installed/icons.rs`):
  - **Linux**: the desktop entries of the XDG data folders and of Flatpak's and Snap's exports;
    not hidden ones, not ones `OnlyShowIn`/`NotShowIn` keeps off this desktop, not terminal
    programs; named in the reader's language; icons by the Icon Theme Specification (the
    reader's theme from KDE's, GNOME's or GTK's setting, the themes it inherits, hicolor,
    `pixmaps`), a large PNG made small, an SVG sent as it is where it is small.
  - **Windows** (`installed/windows.rs`): what All apps lists. The Start menu's shortcuts, the
    machine's and the reader's, read with the shell's `IShellLink` (program, arguments,
    folder) and named as Explorer names them; the Store's applications from the shell's Apps
    folder; and `App Paths` where no shortcut already starts that program. Not a shortcut to
    a document, a help file, a page or a folder, nor an uninstaller; each program and each
    name once. Icons are the shell's own picture of each.
  - **macOS** (`installed/macos.rs`): the bundles in `~/Applications`, `/Applications` and
    `/System/Applications`, two folders deep, by their own names, once each by bundle id, not
    background agents, each run by its bundle's own program; the icon is the smallest PNG of
    the bundle's `icns` that is large enough.
- **The chooser holds all of them**: a find sheet lists every match and scrolls, with only the
  rows near the view in the page (`row-window.ts`), and keeps working as it is typed into.
- **The catalogue** is kept under D1's row limit (`MOST_CATALOGUE`): a host with more than fits
  drops the icons of the last ones first (`fitCatalogue`).

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
- **ffmpeg**, a program the host runs as it runs Xvfb: it is handed the display's frames
  (step 5: read as the display changes, no longer by `x11grab`), libvpx encodes VP8 in its
  realtime mode with no frame held back, and each frame is written to a pipe as IVF the
  moment it is made. VP8 because every viewer's engine decodes it (Orden's CEF has no
  H.264). It starts once the viewer is connected, so the first frame is a key frame. Not
  installed: the viewer is told `encoder`.
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
  character it chose is. Input methods, touch and pen came with step 5.
- **Across networks**: the host asks Cloudflare's STUN, once for each of its sockets, what
  address the internet sees it at (`apps_host/stun.rs`), and puts that in the answer beside its
  own; the viewer asks the account for its servers, `GET /v2/apps/ice`
  (`services/sync/src/apps/ice.ts`, behind the door's switch): Cloudflare's STUN, and TURN with
  credentials that last a day where the Worker has a TURN key (the secrets `TURN_KEY_ID` and
  `TURN_KEY_TOKEN`). Only the viewer relays; the host answers a relayed candidate from its own
  address. An older account answers 404, and the viewer makes do with the STUN.
- **Encoders** (`apps_host/encoder.rs`): each of ffmpeg's hardware encoders that could serve
  (`h264_nvenc`, `h264_vaapi`, `h264_qsv`, `vp9_vaapi`, `vp9_qsv`, `vp8_vaapi`) is tried on one
  frame of a test picture once, as the first application starts, and only those that make it
  are kept. A viewer is sent the best kept one whose codec it decodes - hardware H.264 to
  WebView2 and WKWebView, hardware VP9 or VP8 to Orden's CEF - and libvpx's VP8 otherwise. Each
  holds nothing back (no B-frames, no look-ahead, its lowest-latency mode); H.264 goes out as
  constrained baseline, cut into frames at the access unit delimiters ffmpeg is told to write.

## Size and input (step 5)

- **The display is the holder's tab**, in device pixels, at its ratio: made so when the
  application starts, and again whenever the tab is resized (once the drag has settled,
  `view.ts`), moved to a screen of another ratio, or taken over by another device, whose
  view the relay hands the host with the lock (`apps_view`). Xvfb's screen cannot grow once
  started, so it is made with room for a 4K monitor either way up (more if the first view
  is larger: 64 MiB at least, for as long as the application runs), and RandR sets the part
  in use, with a monitor of that size (`apps_host/display.rs`). Larger than the room, the
  picture is the room's and drawn to fit.
- **A window manager of its own** (`apps_host/wm.rs`) fills the screen with the
  application's main windows and fills it again as it changes; a dialog, a transient
  window or one whose hints hold it smaller keeps its size in the middle; the newest
  window, and the one clicked, has the keyboard. It says the ratio to the toolkits as a
  desktop does: XSETTINGS (`Gdk/WindowScalingFactor`, `Gdk/UnscaledDPI`, `Xft/DPI`), which
  GTK follows live, and `Xft.dpi` in the screen's resources for Qt and Electron, which read
  it as they start.
- **The refresh rate is the holder's screen's**, measured off the frames the page draws
  (when it mounts, when its ratio changes, when the window comes back), and the picture is
  read at most that often, up to 60 a second.
- **Frames only when the display changes** (`apps_host/capture.rs`): DAMAGE says when
  anything is drawn, and only then is the screen read - in memory shared with Xvfb
  (MIT-SHM), as `x11grab` reads it - and handed to the encoder, each frame stamped with the
  time it came. A still application sends nothing.
- **A key frame when one was lost**: a viewer whose picture broke asks for one (PLI or
  FIR), and gets it from an encoder started afresh, which begins with one; at most every
  half second, the next request waiting for that. A screen of another size starts one too.
  Ten seconds' worth of frames brings another, as a net under the requests.
- **The pointer is the holder's own**, with the application's shape for it: the picture
  has no pointer drawn in it, and the host sends the shape whenever it changes over the
  data channel (`{"t":"pointer","png":...,"x":...,"y":...}`, the hot spot in the display's
  pixels, or `{"t":"pointer","hidden":true}`), which the tab draws as the CSS pointer over
  the picture at its ratio.
- **An input method** composes in a text field of the tab's own, put where the pointer last
  pressed; the text it makes comes to the host once chosen (`{"t":"text","text":...}`) and
  is typed a character at a time, on a key of the display's that gives it or a spare one
  lent it. A dead key's letter and a symbol picked from the system's picker come the same
  way.
- **Touch and pen** are the pointer, as X has only the one: the first finger or the pen's
  tip presses its main button, a pen's barrel button the other; the page neither pans nor
  zooms under them. **Precise scrolling** adds up to the wheel's clicks, X having nothing
  finer, with nothing left over lost.
- **Keys held when the tab loses the keyboard** - the window left with Alt held - are let
  go in the application.

## Sound and the clipboard (step 6)

- **Sound** (`apps_host/audio.rs`): as an application starts, the host makes it a sink of its
  own on this computer's sound server (PulseAudio's null sink, with `pactl`; PipeWire's
  pulse server makes one too) and names it to the application as `PULSE_SINK`. Without a
  sound server, or without `pactl` and `parec`, the application is given none
  (`PULSE_SERVER` names nowhere), so nothing it plays ever reaches this computer's speakers.
  The sink goes when the application does.
- The tab offers to take audio beside the video. Once connected, `parec` reads the sink's
  monitor, 10 ms at a time, and ffmpeg encodes it as Opus in its low-delay mode, 10 ms a
  packet, an Ogg page a packet; each packet goes on the connection as it comes, timed by the
  samples it holds. The tab plays it in an `<audio>` of its own, the picture's `<video>`
  staying muted. A host older than this answers no audio, and a tab older than this offers
  none.
- **The clipboard** (`apps_host/clipboard.rs`), text both ways, while the holder shares it:
  **Share the clipboard with applications**, under Code in General while developer mode is
  on, on out of the box and kept on this device (`lib/settings/apps-clipboard.svelte.ts`). The tab says
  whether it shares as the data channel opens and whenever that changes
  (`{"t":"share","clipboard":...}`), and the host gives and takes nothing until told yes.
- **A paste**: Ctrl or Command with V, or Shift with Insert, over the picture. Its press is
  held back while the page pastes into the keyboard's field, which reads this device's
  clipboard without asking for a permission; the text goes to the host
  (`{"t":"clipboard","text":...}`), which takes the display's `CLIPBOARD` and gives it to the
  application's paste in whatever form it asks (`TARGETS`, `UTF8_STRING`, `STRING`, `TEXT`,
  `text/plain`), and then the press. A paste from the application's own menu with the mouse
  gets what this device last pasted there.
- **A copy**: whoever owns the display's `CLIPBOARD` changing (XFIXES) has the host ask the
  new owner for its text, which goes to the tab, which puts it on this device's clipboard.
- At most 200 KiB of text either way, what one data channel message carries everywhere. A
  transfer in pieces (`INCR`) is let go.
- **Not done**: dragging files in and out, and downloads. Both need files carried over the
  connection and, for a drop, X's drag-and-drop played into the application; they are left
  for later.

## Measured (step 9)

- **The developer overlay**: **Stream stats** in the bar over the picture shows, once a
  second while it is open, the picture's size, frame rate and bit rate, glass to glass, the
  connection's round trip and route (`host` straight across, `srflx` or `prflx` through a
  router, `relay` through TURN), frame pacing (the spread of the gaps between frames over
  the second), frames dropped and packets lost, the codec, and the host's encoder, in
  hardware or software (`apps/desktop/src/lib/apps/stats.ts`). Closed, nothing is measured.
- **Glass to glass** is from the moment the host read a frame's picture off the display to
  the moment this screen shows it. A frame's RTP time is when its picture was read, at
  90 kHz from when the connection began on the host's clock. The tab pings the host over the
  data channel (`{"t":"ping","at":...}`), and the host answers with that time back, when the
  connection began and its own time now (`{"t":"pong",...}`, with its encoder). Half the
  round trip is taken as the way there, which sets the two clocks side by side to within
  half a round trip. The engine says each shown frame's RTP time and when it is shown
  (`requestVideoFrameCallback`), and the overlay shows the middle of the last second's.
  What the application itself takes to draw, before the display has it, is not counted.
- **The benchmark** (`latency_benchmark` in `apps_host/stream.rs`, run by CI): on a real
  Xvfb and ffmpeg, from something drawn to its frame arriving at a viewer on the loopback
  (reading, encoding, sending, receiving) in the middle of 20 draws under 50 ms and nine in
  ten under 120 ms; and an application drawing at the refresh rate, 30 here, arriving as at
  least eight frames in ten with no gap over 250 ms. The bounds are well above a quiet
  runner's, so only a real regression fails them; on a loaded machine they can.
- **H.264 frames are not held back**: a frame of H.264 is cut where the next one begins, so
  the last frame before a still screen used to wait for the next. It is now handed on once
  the encoder's output pauses for 2 ms.

## What a tab uses (step 10)

- **In developer mode, a tab's hover card says what it uses**, read once a second while the
  card is up and never otherwise (`apps/desktop/src/lib/tab-strip/facts.ts`):
  - **an application**: the computer it runs on, what it uses there - the processor, the
    memory, the GPU - and its stream: size, frame rate, bit rate, round trip, encoder. The
    host reads its process group's use and sends it with each pong (`usage`), so the card
    holds the picture's measuring (the overlay's, step 9) while it is up. Only the holder has
    the picture's connection, so a device that does not hold the application is told none.
  - **a terminal on this computer**: what its shell and everything under it use
    (`pty_usage`).
- **Read from the kernel** (`src-tauri/src/usage.rs`), on Linux: `/proc/<pid>/stat` for the
  processor's time, `VmRSS` for the memory, and the DRM clients' `fdinfo` for the GPU's
  engines, where the driver says (Intel, AMD and most others since Linux 5.19; not NVIDIA's
  own). The processor is a share of one core, 100 one core whole; the GPU its busiest
  engine. A number that cannot be read is left out, never shown as 0: the GPU of most
  machines, and anything on Windows and macOS yet.
- **Not yet**: online terminals (the machine does not say), agent tabs and web tabs, whose
  processes are the web engine's (CEF, WebView2, WebKit each count them their own way) and
  are sequenced with the owners of that code.

## Windows: a desktop of its own (step 8)

- **Where it runs**: a desktop made with `CreateDesktopW` in the session's window station and
  never switched to (`apps_host/desk.rs`). No screen shows it, nothing on it takes the reader's
  focus, and the reader's mouse and keyboard never reach it. The program starts on it
  (`STARTUPINFO.lpDesktop`) in a job object, so everything it starts is there too and ends
  with it; Stop asks its windows to close and ends the job after 3 s.
- **Its windows fill the view**: a thread on the desktop places each window as it comes, a
  main window at the holder's size, a dialog centred, and again when the view changes.
- **Its picture** (`desk/capture.rs`): each window drawn with `PrintWindow`
  (`PW_RENDERFULLCONTENT`), the back one first, onto a canvas of the view, about 30 times a
  second and compared with the last, so a still application sends nothing. The encoder and the
  WebRTC path are Linux's (`stream.rs`, `encoder.rs`), with AMD's `h264_amf` among the hardware
  encoders; ffmpeg is found on `PATH` or where winget links it, and started with no console.
- **Its input** (`desk/input.rs`): posted to the window it is for by a thread on the desktop.
  The pointer to the deepest window under it, a double click where the window asks for one,
  the wheel at 120 a click; a character as `WM_CHAR`, so the holder's layout decides it; a
  shortcut as a key press with the held modifiers set in the application's keyboard state.
- **Its limits**, said in the tab: a Store application cannot be started on another desktop
  (`packaged`); an application already open on the host often hands itself to that copy and
  opens there (`handed`); some GPU-drawn applications give `PrintWindow` no picture, and those
  that read raw input do not hear the holder's keys. The clipboard and sound are the session's,
  the reader's own at the host, so neither goes to the holder there yet.
- **Checked on CI**: the crate's tests start Notepad on a desktop of its own, see it fill the
  view, draw it, and have a `str0m` viewer get its picture and type into it; and
  `scripts/apps-drive.py`, in check.yml's `apps-windows`, does the same from a probe build's
  WebView2 with its own `RTCPeerConnection`, and keeps the picture it saw.

## A Mac: a display of its own (step 8)

- **Where it runs** (`apps_host/mac/display.rs`): a `CGVirtualDisplay`, a private CoreGraphics
  class reached through the Objective-C runtime by name; a macOS without it says `isolation`.
  It is the holder's size in device pixels, Retina where the holder's screen is, made again as
  the view changes, and moved to the far corner of the other displays, so the reader's pointer
  reaches it only through that corner. One thread holds every display.
- **What a Mac has to allow** (`mac/access.rs`): Screen Recording and Accessibility, each asked
  with the system's prompt as an application first starts. Until both are given the tab says
  so (`permission`).
- **The application** is its bundle's own program (`CFBundleExecutable`), run as a child of
  Orden's in a process group of its own, not `open -a`: a process whose windows are found by
  its id, and a second copy where the reader already has it open.
- **Its windows** (`mac/windows.rs`) are looked at through Accessibility eight times a second
  and moved onto its display: a standard window to fill it, a dialog or panel to its middle.
- **Its picture** (`mac/capture.rs`): ScreenCaptureKit's stream of that display, filtered to the
  application's windows, BGRA at the display's device pixels, no pointer drawn, at most 60 a
  second; only a `Complete` frame is news, so a still application sends nothing. The encoder
  is VideoToolbox's H.264 (`h264_videotoolbox`) to a viewer that decodes H.264, libvpx's VP8 to
  any other; ffmpeg is looked for on `PATH` and in Homebrew's and MacPorts' folders.
- **Its input** (`mac/input.rs`): keys, text, the wheel and a pointer that only moves are posted
  to the application's process. A press goes through the window server, which moves the
  reader's pointer onto the application's display until the last button is let go, then puts
  it back.
- **The clipboard** (`mac/clipboard.rs`) is the system's: a paste puts the holder's text on it
  first, and a change made while the application is in front goes to the holder.
- **Not yet**: its sound (it plays from the Mac's speakers), its pointer's shape, and its menu
  bar (the Mac's own, on the main screen).

## Agents (step 7)

An agent uses an application through its tab: `application_tabs` (docs/agent-native.md 8.18),
under the `applications` scope. It lists the application tabs, starts, stops and restarts
them, reads the frame the tab receives as a PNG, and sends input in the display's pixels
over the picture's own data channel, as the holder's hands do.

- **Only through the holder's connection.** Everything but the list goes only while this
  device holds the application, since the host takes input, Start, Stop and Restart from
  the holder alone. Held by another device, it is refused: Take over is the reader's, and
  no agent presses it. So an agent on computer A drives an application on computer B only
  while A holds it, and never through a real mouse or keyboard.
- In `confirm` mode a start, stop or restart and any input ask first, with "Always" for the
  application; Full permissions asks nothing.
- Not yet: the accessibility tree (AT-SPI), and the clipboard beyond typing text.
