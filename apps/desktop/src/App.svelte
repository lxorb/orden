<script lang="ts">
  import { onDestroy } from 'svelte'
  import { t } from './lib/i18n.svelte'
  import { KEYBOARD_THRESHOLD, viewport } from './lib/viewport.svelte'
  import { closeOnBack } from './lib/backstack.svelte'
  import { EditorView, setVimCommands, showLine, topLine } from '@nib/editor'
  import ContextMenu from './lib/ContextMenu.svelte'
  import FormatBar from './lib/FormatBar.svelte'
  import History from './lib/History.svelte'
  import { menu } from './lib/menu.svelte'
  import Palette from './lib/Palette.svelte'
  import PromptSheet from './lib/PromptSheet.svelte'
  import PaneTree from './lib/PaneTree.svelte'
  import Rail from './lib/Rail.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import SettingsPanel from './lib/SettingsPanel.svelte'
  import SignIn from './lib/SignIn.svelte'
  import StorageWarning from './lib/StorageWarning.svelte'
  import UpdateNotice from './lib/UpdateNotice.svelte'
  import { account } from './lib/account.svelte'
  import Progress from './lib/Progress.svelte'
  import { drawer } from './lib/drawer.svelte'
  import { linkScroll, type ScrollEnd } from './lib/linked-scroll'
  import { search } from './lib/search.svelte'
  import { settings } from './lib/settings.svelte'
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
    quit: () => workspace.activeTabId && workspace.close(workspace.activeTabId),
    edit: () => {
      palette = true
    },
  })

  const title = $derived(
    workspace.active
      ? `${workspace.active.name.replace(/\.(md|markdown|mdown|mkd)$/i, '')}${workspace.active.dirty ? ' ·' : ''}`
      : '',
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
  $effect(() => {
    const token = account.token
    if (token) void modes.adopt(token).then((remote) => remote && shortcuts.receive(remote))
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

  // A phone shows one note at a time, so an arrangement made on a desktop, or on
  // this window before it was made narrow, comes down to one pane.
  $effect(() => {
    if (viewport.phone) workspace.collapsePanes()
  })

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

  // On a phone each of these is a screen of its own, so back closes it rather
  // than leaving the app - newest first, the way Android expects.
  $effect(() => closeOnBack(!!workspace.panel, () => workspace.closePanel()))
  $effect(() =>
    closeOnBack(palette, () => {
      palette = false
    }),
  )
  $effect(() => closeOnBack(menu.open, () => menu.hide()))

  // The drawer follows the finger, the way a phone app's does; see
  // drawer.svelte.ts.
  $effect(() => {
    const host = middle
    if (!host || !viewport.phone) return

    return drawer.follow(host)
  })

  // Syncing only runs while there is an account behind it - and not before a
  // fresh sign-in has settled what happens to the notes already here.
  $effect(() => {
    if (account.syncable) {
      sync.start()
      void usage.refresh()
    } else {
      sync.stop()
    }
  })

  // `window.nib` is the editor view; this is the surrounding app state.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      nibApp: {
        account,
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

  function goto(line: number) {
    if (!view) return

    // Going somewhere in the note means wanting to see it, and on a phone
    // the drawer is in the way.
    if (viewport.phone) workspace.closePanel()

    const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 72 }),
    })
    view.focus()
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

  async function toggleFullscreen() {
    if (!isDesktop) return
    const window = await currentWindow()
    await window.setFullscreen(!(await window.isFullscreen()))
  }

  /** Every app-level key comes from one registry, so a rebind reaches the
   *  keyboard, the menus and the palette at once. The two things it cannot
   *  reach on its own are here: the palette is this component's own state,
   *  and full screen is a property of this window. */
  function onKeydown(event: KeyboardEvent) {
    shortcuts.handle(event, {
      view,
      palette: () => {
        palette = true
      },
      fullscreen: () => void toggleFullscreen(),
    })
  }
</script>

<!-- Nothing in the app ever shows the browser's own menu. -->
<svelte:window
  onkeydown={onKeydown}
  oncontextmenu={(event: MouseEvent) => event.preventDefault()}
/>

<!-- The titlebar spans the whole window, so the rail, the sidebar and the
     document all start on the same line. -->
<!-- The rail and the sidebar run the full height, so the window's one header
     row sits beside them rather than above everything. -->
<main class:focus={modes.focus}>
  <div class="middle" bind:this={middle}>
    <!-- Side by side on a desktop; a drawer over the document on a phone,
         where there is no room for three columns at once. While a finger is on
         it the transform comes from the drag instead, so it tracks the thumb. -->
    <div
      class="panels"
      class:open={!!workspace.panel}
      class:dragging={drawer.at !== null}
      class:settling={drawer.settle !== null}
      style:transform={drawer.at === null || viewport.narrow
        ? undefined
        : `translateX(${drawer.at - drawer.width}px)`}
      style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
      ontransitionend={(event) => drawer.arrived(event)}
    >
      <Rail
        {view}
        onpalette={() => {
          palette = true
        }}
        onhistory={() => {
          settings.historyOpen = true
        }}
      />

      {#if workspace.panel}
        <Sidebar ongoto={goto} />
      {/if}
    </div>

    {#if workspace.panel}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="scrim"
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
      class:dragging={drawer.at !== null}
      class:settling={drawer.settle !== null}
      style:transform={drawer.at === null || !viewport.narrow
        ? undefined
        : `translateX(${drawer.at}px)`}
      style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
      ontransitionend={(event) => drawer.arrived(event)}
    >
      <Titlebar
        onopennotes={() => {
          palette = true
        }}
      />

      <!-- One pane, or up to four of them; see PaneTree.svelte. Anything slow
           enough to be waited for draws a line along the top of them. -->
      <div class="panes">
        <Progress />
        <PaneTree frame={workspace.panes.frame} />
      </div>

      {#if workspace.active?.kind !== 'graph'}
        <StatusBar
          doc={workspace.active?.doc ?? ''}
          reading={modes.readOnly}
          vimMode={modes.vimModeOf(view)}
        />
      {/if}

      <!-- A thumb cannot reach the plus beside the tabs, and on a phone the
           thing you came to do is write a note. Out of the way while the
           keyboard is up, because then you are already writing one. -->
      {#if viewport.phone && !workspace.panel && viewport.keyboard < KEYBOARD_THRESHOLD}
        <button class="fab" aria-label={t('New note')} onclick={() => workspace.createNote()}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      {/if}
    </div>
  </div>
</main>

<StorageWarning />

{#if updates.ready}
  <UpdateNotice version={updates.ready} ondismiss={() => updates.dismiss()} />
{/if}

<Palette bind:open={palette} {view} />
<SignIn />
<SettingsPanel {view} />
<FormatBar bind:this={formatBar} {view} />
<History bind:open={settings.historyOpen} />
<PromptSheet />
<ContextMenu />

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

  /* Sits above the document, clear of the gesture bar. */
  .fab {
    position: absolute;
    right: max(16px, env(safe-area-inset-right));
    bottom: calc(16px + env(safe-area-inset-bottom));
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

  /* ── Phones and narrow windows ─────────────────────────────────── */

  @media (max-width: 720px) {
    .panels {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      transform: translateX(-100%);
      transition: transform var(--dur-base) var(--ease-out);
      box-shadow: var(--shadow-lg);
      /* Clear of a notch or a rounded corner. */
      padding-left: env(safe-area-inset-left);
    }

    .panels.open {
      transform: none;
    }

    /* The finger is the animation while it is down; CSS takes over on release
       and eases the drawer the rest of the way. */
    .panels.dragging,
    .scrim.dragging {
      transition: none;
      animation: none;
    }

    /* After a drag: as long as the distance left asks for, on a curve that
       starts at the finger's pace and eases to a stop rather than snapping. */
    .panels.settling {
      transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
    }

    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 29;
      background: color-mix(in srgb, var(--bg) 55%, transparent);
      backdrop-filter: blur(2px);
      animation: scrim-in var(--dur-fast) var(--ease-out);
    }

    @keyframes scrim-in {
      from {
        opacity: 0;
      }
    }

    /* Full width rather than leaving a sliver of the document showing - and
       once it covers everything it is no longer a drawer over the note but
       the layer beneath it. So here the note is what slides: off to the right
       to uncover the list, back over it when a note is chosen. */
    @media (max-width: 460px) {
      .panels {
        width: 100%;
        z-index: 1;
        transform: none;
        box-shadow: none;
        transition: none;
      }

      .document {
        position: relative;
        z-index: 2;
        background: var(--bg);
        transition: transform var(--dur-base) var(--ease-out);
      }

      .document.open {
        transform: translateX(100%);
      }

      .document.open,
      .document.dragging {
        box-shadow: -16px 0 40px rgb(0 0 0 / 0.3);
      }

      .document.dragging {
        transition: none;
      }

      .document.settling {
        transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
      }

      /* Nothing to dim: the note is either over the list or off the screen. */
      .scrim {
        display: none;
      }
    }
  }
</style>
