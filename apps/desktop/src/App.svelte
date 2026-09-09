<script lang="ts">
  import { onDestroy } from 'svelte'
  import { t } from './lib/i18n.svelte'
  import { scanHeadings } from './lib/outline'
  import { moveSection } from './lib/sections'
  import { viewport } from './lib/viewport.svelte'
  import { closeOnBack } from './lib/backstack.svelte'
  import { takesCaret } from './lib/caret'
  import { EditorView, landed, setVimCommands, showLine, topLine } from '@nib/editor'
  import ContextMenu from './lib/ContextMenu.svelte'
  import FormatBar from './lib/FormatBar.svelte'
  import History from './lib/History.svelte'
  import { iconChoice } from './lib/icon-choice.svelte'
  import IconPicker from './lib/IconPicker.svelte'
  import { menu } from './lib/menu.svelte'
  import { overlays } from './lib/overlays'
  import Palette from './lib/Palette.svelte'
  import PromptSheet from './lib/PromptSheet.svelte'
  import PaneTree from './lib/PaneTree.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import SettingsPanel from './lib/SettingsPanel.svelte'
  import ShareSheet from './lib/ShareSheet.svelte'
  import PublishSheet from './lib/PublishSheet.svelte'
  import JoinSheet from './lib/JoinSheet.svelte'
  import SignIn from './lib/SignIn.svelte'
  import Slides from './lib/Slides.svelte'
  import { present } from './lib/slides/present.svelte'
  import StorageWarning from './lib/StorageWarning.svelte'
  import UpdateNotice from './lib/UpdateNotice.svelte'
  import { account } from './lib/account.svelte'
  import { arriving } from './lib/arriving.svelte'
  import { busy } from './lib/busy.svelte'
  import FirstSync from './lib/FirstSync.svelte'
  import Progress from './lib/Progress.svelte'
  import { drawer } from './lib/drawer.svelte'
  import { fullscreen } from './lib/fullscreen.svelte'
  import { paintCodePalette } from './lib/highlight'
  import { linkScroll, type ScrollEnd } from './lib/linked-scroll'
  import { recovery } from './lib/recovery.svelte'
  import { rooms } from './lib/rooms.svelte'
  import { search } from './lib/search.svelte'
  import { settings } from './lib/settings.svelte'
  import { canWriteAt, share } from './lib/sharing.svelte'
  import { start } from './lib/start'
  import { sync } from './lib/sync.svelte'
  import StatusBar from './lib/StatusBar.svelte'
  import Titlebar from './lib/Titlebar.svelte'
  import { modes } from './lib/modes.svelte'
  import { links } from './lib/link-index.svelte'
  import { updates } from './lib/updates.svelte'
  import { usage } from './lib/usage.svelte'
  import { currentWindow, isDesktop } from './lib/tauri'
  import { theme } from './lib/theme.svelte'
  import { views } from './lib/views.svelte'
  import { workspace } from './lib/workspace.svelte'
  import { shortcuts } from './lib/shortcuts.svelte'

  /** The editor of the pane that has the focus, which is what every key, every
   *  menu and the palette act on. Each pane leaves its own here; see
   *  views.svelte.ts. */
  const view = $derived(views.of(workspace.panes.focusedId))
  /** The tab whose note is on the stage, while one is. The deck goes over the
   *  whole window, and the note stays open behind it. */
  const presenting = $derived(workspace.tabs.find((tab) => tab.id === present.tabId) ?? null)
  /** Whether the note on the stage is one this account may write in. A space
   *  somebody shared to read says the same word in the strip that the reader's
   *  own read-only switch does; see sharing.svelte.ts. */
  const canWriteHere = $derived(!workspace.active?.path || canWriteAt(workspace.active.path))
  let palette = $state(false)
  /** The formatting bar, once it is on the page. */
  let formatBar = $state<{ follow(view: EditorView): void }>()
  /** The element holding both layers, which is what the drawer gesture
   *  listens on. */
  let middle = $state<HTMLElement>()

  // Everything that has to happen as the app comes up; see start.ts.
  onDestroy(start())

  // What `:w`, `:q` and `:e` mean, since all three act on the app rather than
  // on the text. The palette is this component's own state, which is why this
  // is said here rather than in start.ts; `:e` opens it on its note search,
  // which is what a reader typing `:e` is after.
  setVimCommands({
    write: () => void workspace.save(),
    quit: () => void workspace.closeActive(),
    edit: () => {
      palette = true
    },
  })

  const title = $derived(
    workspace.active ? `${workspace.active.shown}${workspace.active.unsaved ? ' ·' : ''}` : '',
  )

  // The header shows no title, so the note's name goes to the window itself -
  // which is what the taskbar and the window switcher read.
  $effect(() => {
    const next = title ? `${title} - Nib` : 'Nib'
    document.title = next
    if (isDesktop) void currentWindow().then((window) => window.setTitle(next))
  })

  // The account's settings come along with the account: when the session is
  // restored at start, and again on signing in. One request brings all of
  // them, so what the modes fetched is handed on rather than asked for twice.
  // A guest has no settings on any account, so there is nothing to ask for.
  $effect(() => {
    const token = account.accountToken
    if (token) {
      void modes.adopt(token).then((remote) => {
        if (!remote) return

        shortcuts.receive(remote)
        recovery.receive(remote)
      })
    }
  })

  // Each pane applies the modes and the keys to its own editor as it builds it;
  // see Pane.svelte. What is left here is the formatting bar, which follows the
  // selection of whichever pane is being written in.
  $effect(() => {
    const bar = formatBar
    if (!bar) return

    views.onSelection = (current: EditorView) => bar.follow(current)
    return () => {
      views.onSelection = null
    }
  })

  // A phone and a tablet show one document at a time, so an arrangement made on a
  // desktop - or on this window before it became one of those devices - comes
  // down to one pane with one document in it. See `workspace.oneDocument`.
  $effect(() => workspace.oneDocument())

  // The icons the account holds for a space's folders, taken on whenever its
  // listing changes. A folder has no file to keep an icon in, so unlike a note's
  // it comes down with the space; here rather than in the syncing loop because it
  // is drawn by the file list and written by a gesture in it, and this is where
  // the account's listing is already being watched. See workspace/folder-icons.
  $effect(() => {
    const who = account.user?.id
    if (!who) return

    for (const space of workspace.spaces) {
      const id = sync.remoteIdFor(space.root)
      const remote = id === null ? undefined : account.spaces.find((one) => one.id === id)
      if (remote) workspace.folderIcons.adopt(space.root, remote.icons, who)
    }
  })

  // The keyboard takes the bottom of the window with it, and the line being
  // written can be left behind it. The height is read so this runs again at each
  // step of the keyboard's arrival rather than once, before there is room.
  $effect(() => {
    const height = viewport.height
    if (!viewport.typing || !view || !height) return

    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main.head, {
        y: 'nearest',
        yMargin: 24,
      }),
    })
  })

  // A deck whose tab has been closed from somewhere else is no longer being
  // presented, and the window goes back to the size it was.
  $effect(() => {
    if (present.on && !presenting) present.stop()
  })

  // The colours a fenced block wears wherever the renderer drew it; see
  // highlight.ts. Here rather than in the theme, because it is the code palette
  // that decides them and that is a mode.
  $effect(() => paintCodePalette(modes.codeTheme))

  // Two panes on one note, scrolling together while the link is on; see
  // linked-scroll.ts. By document position, so a heading stays level in both.
  $effect(() => {
    const panes = workspace.panes.all.filter((pane) => pane.linked)
    const stops = pairs(panes.map((pane) => pane.id))
      .filter(([one, other]) => workspace.twins(one).includes(other))
      .flatMap(([one, other]) => {
        const first = views.of(one)
        const second = views.of(other)
        return first && second ? [linkScroll(scrollEnd(first), scrollEnd(second))] : []
      })

    return () => {
      for (const stop of stops) stop()
    }
  })

  // A drawer over the note is one more thing over the note, so Escape closes it,
  // the way it closes every drawer anybody has used. Only where it is a drawer: a
  // sidebar docked beside the note is over nothing and Escape in the file list
  // still clears the selection.
  $effect(() =>
    viewport.drawer && workspace.panel ? overlays.show(() => workspace.closePanel()) : undefined,
  )

  // On a phone each of these is a screen of its own, so back closes it rather
  // than leaving the app - newest first, the way Android expects.
  $effect(() => closeOnBack(!!workspace.panel, () => workspace.closePanel()))
  $effect(() =>
    closeOnBack(palette, () => {
      palette = false
    }),
  )
  $effect(() => closeOnBack(menu.open, () => menu.hide()))

  // Full screen is one more thing Escape leaves, and one more layer back closes:
  // a screen with nothing on it but the document has to be as easy to leave as
  // everything else the app puts over it.
  $effect(() => (fullscreen.on ? overlays.show(() => void fullscreen.leave()) : undefined))
  $effect(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))

  // And it belongs to the document it was entered on: closing that brings the app
  // back rather than leaving a window with nothing in it. See fullscreen.svelte.ts.
  $effect(() => fullscreen.watch(workspace.tabs.map((tab) => tab.id)))

  // The drawer follows the finger, the way a phone app's does; see
  // drawer.svelte.ts. Only where the sidebar is a drawer: a tablet on its side
  // keeps it open beside the note, and a column in the layout is not dragged.
  $effect(() => {
    const host = middle
    if (!host || !viewport.drawer) return

    return drawer.follow(host)
  })

  // Syncing only runs while there is an account behind it - and not before a
  // fresh sign-in has settled what happens to the notes already here.
  $effect(() => {
    if (account.syncable) {
      sync.start()
      // The bytes are an account's, and a guest is writing into somebody else's.
      if (account.user) void usage.refresh()
    } else {
      sync.stop()
      rooms.clear()
    }
  })

  // The name over a caret is whoever is at this device, and it can change while
  // the note is open: a guest a link let in renaming themselves, or an account
  // choosing a name. Every room they are in hears it at once.
  $effect(() => rooms.rename(account.name ?? undefined))

  // Every open note joins the room its other devices are in. Which notes are open
  // and what the account holds for each are both things the app already knows, so
  // this is the whole of the wiring: no call site has to remember to join or to
  // leave. See rooms.svelte.ts.
  $effect(() => {
    const open = account.syncable
      ? workspace.openNotes.map((one) => ({ ...one, tracked: sync.tracked(one.path) }))
      : []

    rooms.follow(
      open
        .filter((one) => one.tracked !== null)
        .map((one) => ({
          key: one.key,
          note: one.note,
          noteId: one.tracked?.id ?? '',
          hash: one.tracked?.hash ?? null,
        })),
    )
  })

  // A caret is drawn in the shade its colour needs on this background, so the
  // theme changing repaints every room's. Read for its own sake and nothing else:
  // the scheme is what this listens to.
  $effect(() => {
    rooms.repaint(theme.current)
  })

  // `window.nib` is the editor view; this is the surrounding app state.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      nibApp: {
        account,
        arriving,
        busy,
        fullscreen,
        // The picker is opened from a row's menu, which a drive cannot reach; this
        // is how a screenshot run opens it on a note, a canvas or a folder.
        iconChoice,
        rooms,
        share,
        sync,
        workspace,
        search,
        settings,
        modes,
        shortcuts,
        theme,
        viewport,
        links,
        views,
      },
    })
  }

  /** Every pair of panes in a list of them, each pair once. */
  function pairs(ids: string[]): [string, string][] {
    const out: [string, string][] = []
    for (const [at, one] of ids.entries()) {
      for (const other of ids.slice(at + 1)) out.push([one, other])
    }

    return out
  }

  /** An editor as one end of a scroll link: where it is in the note, and how to
   *  put it somewhere in it. */
  function scrollEnd(current: EditorView): ScrollEnd {
    return {
      top: () => topLine(current),
      show: (position: number) => showLine(current, position),
      onScroll: (run: () => void) => {
        current.scrollDOM.addEventListener('scroll', run, { passive: true })
        return () => current.scrollDOM.removeEventListener('scroll', run)
      },
    }
  }

  /** The two buttons on the side of a mouse. They are the browser's back and
   *  forward everywhere else, so they are the tab's here - and the browser's own
   *  is taken off them, or the web build would leave the app entirely. */
  function onMouse(event: MouseEvent) {
    if (event.button !== 3 && event.button !== 4) return

    event.preventDefault()
    if (event.button === 3) workspace.goBack()
    else workspace.goForward()
  }

  function goto(line: number) {
    if (!view) return

    // Going somewhere in the note means wanting to see it, and a drawer is in
    // the way. A sidebar docked beside the note is not, and stays.
    if (viewport.drawer) workspace.closePanel()

    const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      // The block it landed on says so for a moment: a caret is a pixel wide and
      // the eye was somewhere else. See landing.ts in @nib/editor.
      effects: [
        EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 72 }),
        landed.of(target.from),
      ],
    })
    view.focus()
  }

  /** A whole section moved, from the outline. One transaction, so it is one
   *  thing to undo, and the words it moves are the only words that change - a
   *  note open in another pane keeps every caret outside them where it was; see
   *  sections.ts and shared.ts. */
  function moveSectionTo(from: number, to: number) {
    // The pane holding the note the outline is about, which is the one being
    // worked in unless a panel is held on another; see panelTab in
    // workspace.svelte.ts. Dragging a section moves the note the rows came from.
    const view = views.of(workspace.panelTab?.paneId ?? workspace.panes.focusedId)
    if (!view || view.state.readOnly) return

    const text = view.state.doc.toString()
    const made = moveSection(text, scanHeadings(text), from, to, view.state.selection.main.head)
    if (!made) return

    view.dispatch({
      changes: made.changes,
      selection: { anchor: made.caret },
      scrollIntoView: true,
      userEvent: 'move.section',
    })
  }

  // A followed link, or a bookmarked heading, lands on a line the editor cannot
  // know: the workspace works it out from the note it just loaded and leaves it
  // here.
  //
  // Two things about the timing, both of which used to leave the note open at
  // its top instead. The view is waited for rather than checked inside `goto`,
  // because opening another note builds a new one and for a moment there is
  // none. And the jump is made on the next frame, because a fresh view is given
  // the place the note was last read at on the frame after it appears - see
  // placement.svelte.ts, whose effect is declared above this one and so takes
  // that frame first. Being asked for a heading is newer than being remembered
  // at a line, so this lands on top.
  $effect(() => {
    const asked = workspace.goto
    if (!asked || !view || workspace.active?.path !== asked.path) return

    // Taking the ask down runs this effect again, so nothing is returned to
    // undo the frame: a teardown here would cancel the very jump just asked
    // for. The frame is harmless on its own - `goto` needs a view.
    workspace.goto = null
    requestAnimationFrame(() => goto(asked.line))
  })

  /** What is showing in the pane that has the focus, as the caret rule reads it. */
  const showing = $derived(workspace.showing(workspace.panes.focusedId))

  // The caret goes into the note that is showing, whichever of the many doors it
  // was opened by; see caret.ts for the rule and why there is one. On the frame
  // after, for the reason the jump below waits too: a fresh view is given its
  // remembered place a frame after it appears, and taking the keyboard before
  // that would scroll the note to the caret instead of to where it was left.
  $effect(() => {
    const current = view
    // Read, not used: these are what this effect is watching for. Whether the
    // caret may be taken is decided on the frame, by which time whatever was
    // over the note - the palette a note was chosen in - has gone.
    // Which panel is open is not one of them. A panel opening is not a note
    // arriving, and a key that opens one asks for the keyboard to go into it - so
    // watching the panel here is how Ctrl+Shift+E opened the file list and then
    // took the keyboard straight back out of it. See revealPanel in focus.ts.
    const reasons = [showing?.id, showing?.kind, showing?.reading, workspace.naming, palette]
    if (!current || !reasons.length) return

    const frame = requestAnimationFrame(() => {
      const may = takesCaret(showing ? { kind: showing.kind, reading: showing.reading } : null, {
        overlaid: overlays.depth > 0,
        renaming: workspace.naming !== null,
        presenting: present.on,
        touch: viewport.touch,
      })

      if (may) current.focus()
    })

    return () => cancelAnimationFrame(frame)
  })

  /** Every app-level key comes from one registry, so a rebind reaches the
   *  keyboard, the menus and the palette at once. The one thing it cannot reach
   *  on its own is here: the palette is this component's own state. */
  function onKeydown(event: KeyboardEvent) {
    // Escape closes whatever is over the note, newest first: the settings, a
    // sheet, the palette, a menu, a dropdown inside one of them. Only when
    // there is one, so Escape in the file list still clears the selection and
    // Escape in the editor still steps off a picture. The press goes no further
    // than the one it closed, which is what keeps a note's find bar open under a
    // palette somebody has just dismissed. See overlays.ts.
    if (event.key === 'Escape' && overlays.escape(event)) return

    // A deck covers the window, so anything the app would open under it is a
    // window nobody can see holding the keyboard nobody can get back. While a
    // note is being presented the only app key is the one that stops.
    if (present.on && !shortcuts.pressed('app.present', event)) return

    shortcuts.handle(event, {
      view,
      palette: () => {
        palette = true
      },
      // The document alone, with the app out of the way and the window's own
      // frame with it; see fullscreen.svelte.ts.
      fullscreen: () => void fullscreen.toggle(workspace.activeTabId),
    })
  }
</script>

<!-- Nothing in the app ever shows the browser's own menu. -->
<svelte:window
  onkeydown={onKeydown}
  oncontextmenu={(event: MouseEvent) => event.preventDefault()}
  onmousedown={onMouse}
  onpointermove={() => fullscreen.stir()}
  onpointerdown={() => fullscreen.stir()}
/>

<!-- The sidebar runs the full height, so the window's one header row sits beside
     it rather than above everything, and the panel and the document start on
     the same line. -->
<!-- Nothing in the app is reachable while the account's writing is still on
     its way: a note half arrived is not one to type into. See FirstSync.svelte. -->
<main class:focus={modes.focus} class:full={fullscreen.on} inert={arriving.showing}>
  <div class="middle" bind:this={middle}>
    <!-- Side by side on a desktop; a drawer over the document on a phone,
         where there is no room for three columns at once. While a finger is on
         it the transform comes from the drag instead, so it tracks the thumb. -->
    <!-- Wherever the panels are a drawer, a shut drawer is off screen: at the
         narrow end it is behind the note, and above that it is slid off to the
         side. Either way nothing in it can be reached, so nothing in it is
         announced or reachable by a key either - which is what keeps the
         drawer's own sidebar button from being read out on a phone held
         sideways, where the only thing a thumb can reach is the bar's. -->
    <!-- Full screen leaves the document and nothing else: no file list, no
         bars. Left out rather than slid away, so nothing in them can be reached
         by a key while they are gone; see fullscreen.svelte.ts. -->
    {#if !fullscreen.on}
      <div
        class="panels"
        inert={viewport.drawer && !workspace.panel}
        class:open={!!workspace.panel}
        class:held={drawer.held}
        class:dragging={drawer.at !== null}
        class:settling={drawer.settle !== null}
        style:transform={drawer.at === null || viewport.narrow
          ? undefined
          : `translateX(${drawer.at - drawer.width}px)`}
        style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
        ontransitionend={(event) => drawer.arrived(event)}
      >
        {#if workspace.panel}
          <Sidebar ongoto={goto} onmovesection={moveSectionTo} />
        {/if}
      </div>
    {/if}

    {#if workspace.panel && !fullscreen.on}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="scrim"
        class:held={drawer.held}
        class:dragging={drawer.at !== null}
        style:opacity={drawer.at === null || !drawer.width ? undefined : drawer.at / drawer.width}
        onclick={() => workspace.closePanel()}
      ></div>
    {/if}

    <!-- On a phone too narrow for the drawer to leave any of the note showing,
         the layers swap: the list is the floor and the note is what moves,
         sliding off to the right to uncover it and back over it. The same
         drag drives both; only which layer it moves differs. -->
    <div
      class="document"
      class:open={!!workspace.panel}
      class:held={drawer.held}
      class:dragging={drawer.at !== null}
      class:settling={drawer.settle !== null}
      style:transform={drawer.at === null || !viewport.narrow
        ? undefined
        : `translateX(${drawer.at}px)`}
      style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
      ontransitionend={(event) => drawer.arrived(event)}
    >
      <!-- The three dots at the right end of it open the whole of the app on a
           phone and a tablet, which is why the bar is handed what the menu needs;
           see AppMenu.svelte. -->
      {#if !fullscreen.on}
        <Titlebar
          {view}
          onpalette={() => {
            palette = true
          }}
          onhistory={() => {
            settings.historyOpen = true
          }}
        />
      {/if}

      <!-- One pane, or up to four of them; see PaneTree.svelte. Anything slow
           enough to be waited for draws a line along the top of them. -->
      <div class="panes">
        <Progress />
        <PaneTree frame={workspace.panes.frame} />
      </div>

      {#if workspace.active?.kind !== 'graph' && !fullscreen.on}
        <StatusBar
          doc={workspace.active?.doc ?? ''}
          reading={modes.readOnly || !canWriteHere}
          vimMode={modes.vimModeOf(view)}
        />
      {/if}

      <!-- A thumb cannot reach the plus beside the tabs, and on a phone the
           thing you came to do is write a note. Out of the way while the
           keyboard is up, because then you are already writing one. -->
      {#if viewport.touch && !workspace.panel && !viewport.typing && !fullscreen.on}
        <button class="fab" aria-label={t('New note')} onclick={() => workspace.createNote()}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      {/if}

      <!-- The way back out of full screen, in the corner the bar's own buttons
           were in. It fades once nothing has moved for a while - it is a way out,
           not part of what is being read - and stays there faintly rather than
           going, because a screen with no way off it is the one thing this must
           never be. Escape, back on Android and the menu row do the same. -->
      {#if fullscreen.on}
        <button
          class="leave"
          class:idle={fullscreen.idle}
          title={t('Leave fullscreen')}
          aria-label={t('Leave fullscreen')}
          onclick={() => void fullscreen.leave()}
        >
          <svg viewBox="0 0 16 16">
            <path d="M6.5 2.5v4h-4M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 13.5v-4h4" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</main>

<!-- Over everything, with no chrome of its own: while a note is being presented
     the window is the deck. -->
{#if presenting}
  <Slides tab={presenting} />
{/if}

<StorageWarning />

{#if updates.ready}
  <UpdateNotice version={updates.ready} ondismiss={() => updates.dismiss()} />
{/if}

<Palette bind:open={palette} {view} />
<SignIn />
<!-- The one word a link owes whoever followed it, when it owes one. -->
<JoinSheet />
<SettingsPanel {view} />
<FormatBar bind:this={formatBar} {view} />
<History bind:open={settings.historyOpen} />
<ShareSheet />
<PublishSheet />
<PromptSheet />
<ContextMenu />
<!-- Over everything, because everything that wears an icon asks the same sheet
     for one: a space in the switcher, a note in the file list. -->
<IconPicker />
<FirstSync />

<style>
  main {
    display: flex;
    flex-direction: column;
    /* Dynamic units: a phone's address bar eats into the viewport as it
       scrolls, and `vh` would leave the editor taller than the screen. */
    height: 100vh;
    height: 100dvh;
    background: var(--bg);
    transition: background var(--dur-slow) var(--ease-out);
  }

  .middle {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .panels {
    display: flex;
    min-height: 0;
  }

  .scrim {
    display: none;
  }

  .document {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Positioned, so the line that says the app is busy draws along the top of
     the panes rather than over the window's own bar. */
  .panes {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  /* Full screen: the panes are the whole window, so what the system keeps for
     its clock, its cutout and its gesture bar is kept clear here instead of by
     the bars that have gone. */
  main.full .panes {
    padding: var(--inset-top) var(--inset-right) var(--inset-bottom) var(--inset-left);
  }

  /* The way back, in the corner the window's own buttons were in. Small, and
     quieter still once nothing has moved for a while - but never gone: it stays
     reachable by a finger and by a key. */
  .leave {
    position: absolute;
    top: max(var(--space-2), var(--inset-top));
    right: max(var(--space-2), var(--inset-right));
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-3) 82%, transparent);
    color: var(--muted-strong);
    box-shadow: var(--shadow-sm);
    cursor: default;
    width: 30px;
    height: 30px;
    transition:
      opacity var(--dur-slow) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  /* Arrives with the screen it belongs to rather than appearing on it. In CSS,
     so it goes with the tokens under reduced motion. */
  .leave {
    animation: arrive var(--dur-base) var(--ease-out);
  }

  @keyframes arrive {
    from {
      opacity: 0;
    }
  }

  .leave.idle {
    opacity: 0.22;
  }

  @media (hover: hover) {
    .leave:hover {
      opacity: 1;
      background: var(--surface-3);
      color: var(--text-strong);
    }
  }

  .leave:active {
    opacity: 1;
    background: var(--press);
    color: var(--text-strong);
  }

  .leave:focus-visible {
    opacity: 1;
    outline-offset: 2px;
  }

  .leave svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A thumb's target rather than a pointer's, and drawn at the size every other
     icon on a touch screen is. */
  :global([data-touch]) .leave {
    width: var(--touch-target);
    height: var(--touch-target);
  }

  :global([data-touch]) .leave svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  /* Sits above the document, clear of the gesture bar. */
  .fab {
    position: absolute;
    right: max(16px, var(--inset-right));
    bottom: calc(16px + var(--inset-bottom));
    z-index: 20;
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 18px;
    background: var(--accent);
    color: #fff;
    box-shadow: var(--shadow-lg);
    cursor: default;
    transition: transform var(--dur-fast) var(--ease-spring);
  }

  .fab:active {
    transform: scale(0.92);
  }

  .fab svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  /* Clear of a notch or a rounded corner, whether the panels are a drawer over
     the note or a column beside it. */
  :global([data-touch]) .panels {
    padding-left: var(--inset-left);
  }

  /* ── Where the sidebar is a drawer over the note ─────────────────── */

  :global([data-drawer]) .panels {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 30;
    transform: translateX(-100%);
    transition: transform var(--dur-base) var(--ease-out);
    box-shadow: var(--shadow-lg);
  }

  :global([data-drawer]) .panels.open {
    transform: none;
  }

  /* A finger is down on something that is about to move. Promoting the layer
     now rather than on the first move means the drag starts on the frame it
     was asked for, and the hint goes again the moment the finger lifts: a
     layer nothing is moving is a layer paid for and not used. */
  :global([data-drawer]) .panels.held,
  :global([data-drawer]) .document.held {
    will-change: transform;
  }

  :global([data-drawer]) .scrim.held {
    will-change: opacity;
  }

  /* The finger is the animation while it is down; CSS takes over on release
     and eases the drawer the rest of the way. */
  :global([data-drawer]) .panels.dragging,
  :global([data-drawer]) .scrim.dragging {
    transition: none;
    animation: none;
  }

  /* After a drag: as long as the distance left asks for, on a curve that
     starts at the finger's pace and eases to a stop rather than snapping. */
  :global([data-drawer]) .panels.settling {
    transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Colour and nothing else. A blur here is a filter the compositor has to
     redraw over the whole screen on every frame of the drag, which is most of
     what a drawer swipe used to cost. */
  :global([data-drawer]) .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 29;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    animation: scrim-in var(--dur-fast) var(--ease-out);
  }

  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }

  /* Full width rather than leaving a sliver of the document showing - and once
     it covers everything it is no longer a drawer over the note but the layer
     beneath it. Only where the panels are a drawer at all: `data-narrow` is the
     width and nothing else, and a desktop window dragged this narrow still has
     its columns. So here the note is what slides: off to the right to uncover
     the list, back over it when a note is chosen. */
  :global([data-drawer][data-narrow]) .panels {
    width: 100%;
    z-index: 1;
    transform: none;
    box-shadow: none;
    transition: none;
  }

  :global([data-drawer][data-narrow]) .document {
    position: relative;
    z-index: 2;
    background: var(--bg);
    transition: transform var(--dur-base) var(--ease-out);
  }

  :global([data-drawer][data-narrow]) .document.open {
    transform: translateX(100%);
  }

  :global([data-drawer][data-narrow]) .document.open,
  :global([data-drawer][data-narrow]) .document.dragging {
    box-shadow: -16px 0 40px rgb(0 0 0 / 0.3);
  }

  :global([data-drawer][data-narrow]) .document.dragging {
    transition: none;
  }

  :global([data-drawer][data-narrow]) .document.settling {
    transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Nothing to dim: the note is either over the list or off the screen. */
  :global([data-drawer][data-narrow]) .scrim {
    display: none;
  }
</style>
