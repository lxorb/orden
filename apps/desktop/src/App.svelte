<script lang="ts">
  import { onDestroy } from 'svelte'
  import { key, message, t } from './lib/i18n.svelte'
  import { KEYBOARD_THRESHOLD, viewport } from './lib/viewport.svelte'
  import { closeOnBack } from './lib/backstack.svelte'
  import { EditorView, type NoteJump, type Text } from '@nib/editor'
  import ContextMenu from './lib/ContextMenu.svelte'
  import Editor from './lib/Editor.svelte'
  import FormatBar from './lib/FormatBar.svelte'
  import Graph from './lib/Graph.svelte'
  import History from './lib/History.svelte'
  import { menu } from './lib/menu.svelte'
  import Palette from './lib/Palette.svelte'
  import PromptSheet from './lib/PromptSheet.svelte'
  import Rail from './lib/Rail.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import SettingsPanel from './lib/SettingsPanel.svelte'
  import SignIn from './lib/SignIn.svelte'
  import StorageWarning from './lib/StorageWarning.svelte'
  import UpdateNotice from './lib/UpdateNotice.svelte'
  import { account } from './lib/account.svelte'
  import { busy } from './lib/busy.svelte'
  import Progress from './lib/Progress.svelte'
  import { drawer } from './lib/drawer.svelte'
  import { showEditorMenu } from './lib/editor-menu'
  import { placement } from './lib/placement.svelte'
  import { settings } from './lib/settings.svelte'
  import { start } from './lib/start'
  import { sync } from './lib/sync.svelte'
  import StatusBar from './lib/StatusBar.svelte'
  import Titlebar from './lib/Titlebar.svelte'
  import { modes } from './lib/modes.svelte'
  import { imageUrl } from './lib/images'
  import { links } from './lib/link-index.svelte'
  import { storeImage } from './lib/assets'
  import { updates } from './lib/updates.svelte'
  import { usage } from './lib/usage.svelte'
  import { currentWindow, isDesktop, openExternal } from './lib/tauri'
  import { theme } from './lib/theme.svelte'
  import { workspace } from './lib/workspace.svelte'
  import { shortcuts } from './lib/shortcuts.svelte'

  let view = $state<EditorView>()
  let palette = $state(false)
  /** The formatting bar, once it is on the page. */
  let formatBar = $state<{ follow(view: EditorView): void }>()
  /** The element holding both layers, which is what the drawer gesture
   *  listens on. */
  let middle = $state<HTMLElement>()

  // Everything that has to happen as the app comes up; see start.ts.
  onDestroy(start())

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

  // A new view starts with no modes and no keys applied, so re-apply on
  // every swap.
  $effect(() => {
    if (view) modes.apply(view)
    if (view) shortcuts.apply(view)
  })

  // Reopening a note lands where it was left; see placement.svelte.ts.
  $effect(() => {
    const current = view
    const id = workspace.activeTabId
    // A preview tab moves on to another note without becoming another tab,
    // so the note's own place has to be read again when that happens.
    const path = workspace.active?.path ?? null
    if (!current || !id) return

    return placement.follow(current, id, path)
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
      nibApp: { account, sync, workspace, settings, modes, theme, viewport, links },
    })
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

  /** A pasted or dropped image, stored once however often it is pasted. A large
   *  screenshot takes a moment to hash and write, and nothing appears in the
   *  note until it has, so the line at the top says so meanwhile. */
  async function saveImage(file: File): Promise<string | null> {
    try {
      const src = await busy.run(t('Storing the image'), () =>
        storeImage(file, workspace.active?.path ?? null),
      )
      void usage.refresh()
      return src
    } catch (error) {
      // The one failure worth interrupting for: nothing else the editor does
      // will work either until something is deleted.
      void usage.refresh()
      settings.error = message(error, key('That image does not fit in your storage.'))
      return null
    }
  }

  function resolveImage(src: string): string {
    // A picture an embed names by file name alone may live anywhere in the
    // space, the way Obsidian resolves an attachment; the index knows where.
    const root = workspace.activeSpace?.root
    const found = root && !src.includes('/') ? links.fileNamed(src) : null
    const path = found && root ? `${root}/${found}` : src

    return imageUrl(path, workspace.active?.path, workspace.active?.doc ?? '')
  }

  /** Names a block of another note, so a `[[…#^` link can point at it. */
  function nameBlock(path: string, line: number): Promise<string | null> {
    const root = workspace.activeSpace?.root
    return root ? links.nameBlock(path, line, root) : Promise.resolve(null)
  }

  // A followed link lands on a heading or a block, which the editor cannot know
  // the line of: the workspace works it out from the note it just loaded and
  // leaves it here.
  $effect(() => {
    const asked = workspace.goto
    if (!asked || workspace.active?.path !== asked.path) return

    workspace.goto = null
    goto(asked.line)
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

      {#if workspace.active?.kind === 'graph'}
        <!-- The graph of the space is a tab like a note is, so it takes the note's
             place in the window rather than a surface of its own. -->
        <Graph
          graph={links.graph}
          current={workspace.relativeNote}
          onopen={(path: string, keep: boolean) => workspace.openRelative(path, keep)}
          onescape={() => workspace.activeTabId && workspace.close(workspace.activeTabId)}
        />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="editor" oncontextmenu={(event: MouseEvent) => showEditorMenu(event, view)}>
          <!-- Anything slow enough to be waited for draws a line along the top
             of the document, just under the tabs. -->
          <Progress />
          {#key workspace.activeTabId}
            <Editor
              bind:view
              doc={workspace.active?.doc ?? ''}
              pushed={workspace.active?.pushed ?? 0}
              onchange={(text: Text) => {
                workspace.edit(text)
              }}
              onimage={saveImage}
              resolveimage={resolveImage}
              openlink={(href: string) => void openExternal(href)}
              notes={links.index(workspace.active?.path ?? null)}
              opennote={(jump: NoteJump) => void workspace.followLink(jump)}
              nameblock={(path: string, line: number) => nameBlock(path, line)}
              onselection={(current: EditorView) => {
                formatBar?.follow(current)
                placement.remember()
              }}
            />
          {/key}
        </div>

        <StatusBar doc={workspace.active?.doc ?? ''} reading={modes.reading} />
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

  .editor {
    position: relative;
    flex: 1;
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
