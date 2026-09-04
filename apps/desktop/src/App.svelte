<script lang="ts">
  import { flushSync, untrack } from 'svelte'
  import { i18n, key, message, t } from './lib/i18n.svelte'
  import { KEYBOARD_THRESHOLD, viewport } from './lib/viewport.svelte'
  import { closeOnBack } from './lib/backstack.svelte'
  import {
    CLAIM,
    claimsGesture,
    scrollsSideways,
    SETTLE_MAX,
    SETTLE_MIN,
    settleOpen,
  } from './lib/swipe'
  import {
    clearFormatting,
    EditorView,
    type StateCommand,
    type Transaction,
    insertCodeFence,
    insertHorizontalRule,
    insertLink,
    insertPageBreak,
    insertTableToEdit,
    toggleBulletList,
    toggleOrderedList,
    toggleQuote,
    toggleWrap,
  } from '@nib/editor'
  import ContextMenu from './lib/ContextMenu.svelte'
  import Editor from './lib/Editor.svelte'
  import FormatBar from './lib/FormatBar.svelte'
  import History from './lib/History.svelte'
  import { DIVIDER, type MenuEntry, menu } from './lib/menu.svelte'
  import Palette from './lib/Palette.svelte'
  import PromptSheet from './lib/PromptSheet.svelte'
  import Rail from './lib/Rail.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import SettingsPanel from './lib/SettingsPanel.svelte'
  import SignIn from './lib/SignIn.svelte'
  import StorageWarning from './lib/StorageWarning.svelte'
  import UpdateNotice from './lib/UpdateNotice.svelte'
  import { account } from './lib/account.svelte'
  import { settings } from './lib/settings.svelte'
  import { sync } from './lib/sync.svelte'
  import StatusBar from './lib/StatusBar.svelte'
  import Titlebar from './lib/Titlebar.svelte'
  import { modes } from './lib/modes.svelte'
  import { imageUrl } from './lib/images'
  import { storeImage } from './lib/assets'
  import { usage } from './lib/usage.svelte'
  import { collectErrors } from './lib/log'
  import { prompt } from './lib/prompt.svelte'
  import { newSpace } from './lib/space-actions'
  import { installStaged, ready, stageUpdate } from './lib/updater'
  import { currentWindow, invoke, isDesktop } from './lib/tauri'
  import { theme } from './lib/theme.svelte'
  import { workspace } from './lib/workspace.svelte'

  let view = $state<EditorView>()
  let palette = $state(false)
  let formatBar = $state<FormatBar>()

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

  collectErrors()
  viewport.start()
  i18n.restore()
  theme.init()
  modes.restore()
  settings.restore()
  void workspace.restore().then(openLaunchFiles)
  void guardClose()
  /** The version waiting to be installed, once one has been downloaded. */
  let updateReady = $state<string | null>(null)

  // Fetched quietly at startup. It would take effect on the next launch by
  // itself; the notice just offers to get there sooner.
  void stageUpdate().then((version) => (updateReady = version))
  void account.restore()

  // A new view starts with no modes applied, so re-apply on every swap.
  $effect(() => {
    if (view) modes.apply(view)
  })

  /** The tab whose caret and scroll have been put back. Nothing is recorded
   *  before that, or the fresh view's caret at 0 would overwrite the real one.
   *
   *  Deliberately not `$state`: nothing renders from it, and the effect below
   *  both writes it and reads it back through `remember`. As reactive state
   *  that is a cycle, and Svelte answers a cycle by tearing down the whole
   *  render loop - which looked like tabs that only switched after a reload. */
  let placed: string | null = null

  // Reopening a note lands where it was left, and keeps saying where that is,
  // because a crash gives no chance to write it down on the way out.
  $effect(() => {
    const current = view
    const id = workspace.activeTabId
    if (!current || !id) return

    const tab = untrack(() => workspace.tabs.find((one) => one.id === id))
    const at = Math.min(untrack(() => tab?.cursor ?? 0), current.state.doc.length)
    const top = untrack(() => tab?.scroll ?? 0)

    // The caret needs no layout, so it goes back now, and recording starts the
    // moment it has. Waiting would let the fresh view's caret at 0 be written
    // down as the real one.
    current.dispatch({ selection: { anchor: at } })
    placed = id

    // The scroll offset does need layout, and there is none until a frame has
    // been drawn.
    const frame = requestAnimationFrame(() => {
      current.scrollDOM.scrollTop = top
    })

    const remember = () => {
      if (placed !== id) return
      workspace.noteView(id, current.state.selection.main.head, current.scrollDOM.scrollTop)
    }

    current.scrollDOM.addEventListener('scroll', remember, { passive: true })

    return () => {
      cancelAnimationFrame(frame)
      current.scrollDOM.removeEventListener('scroll', remember)
      remember()
      placed = null
    }
  })

  // On a phone each of these is a screen of its own, so back closes it rather
  // than leaving the app - newest first, the way Android expects.
  $effect(() => closeOnBack(!!workspace.panel, () => workspace.showPanel(workspace.panel!)))
  $effect(() => closeOnBack(palette, () => (palette = false)))
  $effect(() => closeOnBack(menu.open, () => menu.hide()))

  /** How far the drawer is pulled out while a finger is on it, in pixels.
   *  `null` hands it back to CSS, which is what animates the settle. */
  let drag = $state<number | null>(null)
  /** How far it can travel, measured when the gesture starts. */
  let dragWidth = $state(0)
  /** How long the drawer takes to settle once the finger lifts, in
   *  milliseconds. The tap-to-open transition is tuned to feel prompt, which
   *  is far too quick for the last stretch of a drag: the drawer would leap
   *  the rest of the way. Set from how far it still has to go, and cleared
   *  once it has arrived so a tap goes back to being prompt. */
  let settle = $state<number | null>(null)

  /** Buttons inside a layer finish transitions of their own; only the layer's
   *  own slide means it has arrived. */
  function arrived(event: TransitionEvent) {
    if (event.target === event.currentTarget && event.propertyName === 'transform') settle = null
  }
  let middle = $state<HTMLElement>()

  // The drawer follows the finger, the way a phone app's does. Attached by
  // hand rather than with `ontouchmove`, because claiming the gesture means
  // calling preventDefault, and that needs a listener that is not passive.
  $effect(() => {
    const host = middle
    if (!host || !viewport.phone) return

    let startX = 0
    let startY = 0
    let width = 0
    let claimed = false
    let openedByDrag = false
    /** The drawer is only as wide as the rail until the sidebar inside it
     *  mounts, so opening has to re-measure once it has. */
    let measured = false
    let lastX = 0
    let lastAt = 0
    let velocity = 0

    const panels = () => host.querySelector<HTMLElement>('.panels')

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return

      const touch = event.touches[0]
      claimed = false
      openedByDrag = false
      measured = false

      // From anywhere on the screen, not just the edge: an edge-only gesture is
      // a thin target and easy to miss. The one thing that outranks it is
      // something that scrolls sideways under the finger.
      if (scrollsSideways(document.elementFromPoint(touch.clientX, touch.clientY), host)) return

      startX = touch.clientX
      startY = touch.clientY
      lastX = touch.clientX
      lastAt = event.timeStamp
      velocity = 0
      // Zero means there is nothing to drag, and every later handler bails.
      width = panels()?.getBoundingClientRect().width ?? 0
      dragWidth = width
    }

    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !width) return

      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!claimed) {
        // Settled once: a scroll stays a scroll for the whole gesture, and a
        // drag stays a drag. Going vertical first gives the drawer up.
        if (Math.abs(dy) > CLAIM) {
          width = 0
          return
        }
        if (!claimsGesture(dx, dy)) return
        // Closed, only a rightward pull opens it; a leftward one on the
        // document means nothing and should be left alone.
        if (!workspace.panel && dx < 0) {
          width = 0
          return
        }

        claimed = true

        if (!workspace.panel) {
          workspace.showPanel('tree')
          openedByDrag = true

          // Closed, the drawer is only as wide as the rail, and dragging
          // against that width would snap it open in a few pixels. `flushSync`
          // puts the sidebar in the DOM now so the real width can be read -
          // waiting a frame would be at the mercy of a throttled clock.
          flushSync()
          width = panels()?.getBoundingClientRect().width ?? width
          dragWidth = width
        }

        measured = true
      }

      if (!measured) return

      const elapsed = event.timeStamp - lastAt
      if (elapsed > 0) velocity = (touch.clientX - lastX) / elapsed
      lastX = touch.clientX
      lastAt = event.timeStamp

      // Opening counts from nothing; closing counts down from wide open.
      const base = openedByDrag ? 0 : width
      drag = Math.max(0, Math.min(width, base + dx))
      event.preventDefault()
    }

    const onEnd = () => {
      if (!claimed) return

      const settled = settleOpen(drag ?? 0, width, velocity)
      // The remaining distance decides the time, so the drawer moves at
      // roughly the same pace whether it was let go near its end or its start.
      const remaining = Math.abs((drag ?? 0) - (settled ? width : 0))
      settle = Math.round(SETTLE_MIN + (SETTLE_MAX - SETTLE_MIN) * (width ? remaining / width : 0))
      drag = null
      claimed = false

      if (settled !== !!workspace.panel) workspace.showPanel(workspace.panel ?? 'tree')
    }

    host.addEventListener('touchstart', onStart, { passive: true })
    host.addEventListener('touchmove', onMove, { passive: false })
    host.addEventListener('touchend', onEnd)
    host.addEventListener('touchcancel', onEnd)

    return () => {
      host.removeEventListener('touchstart', onStart)
      host.removeEventListener('touchmove', onMove)
      host.removeEventListener('touchend', onEnd)
      host.removeEventListener('touchcancel', onEnd)
    }
  })

  // Syncing only runs while there is an account behind it.
  $effect(() => {
    if (account.signedIn) {
      sync.start()
      void usage.refresh()
    } else {
      sync.stop()
    }
  })

  // `window.nib` is the editor view; this is the surrounding app state.
  if (import.meta.env.DEV) {
    Object.assign(window, { nibApp: { account, sync, workspace, settings, modes, theme, viewport } })
  }

  function goto(line: number) {
    if (!view) return

    // Going somewhere in the note means wanting to see it, and on a phone
    // the drawer is in the way.
    if (viewport.phone && workspace.panel) workspace.showPanel(workspace.panel)

    const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 72 }),
    })
    view.focus()
  }

  /** Nothing with words in it is lost on the way out: closing asks first. */
  async function guardClose() {
    const window = await currentWindow()
    await window.onCloseRequested(async (event) => {
      // A tab gets no chance to ask its own question - `beforeunload` runs to
      // completion before anything is painted. Preventing it is the whole
      // signal, and the browser puts up its own leave-page dialog.
      if (!isDesktop) {
        if (workspace.unsaved.length) event.preventDefault()
        return
      }

      // Nothing to ask about, but there may still be an update to put in place.
      if (!workspace.unsaved.length) {
        if (!ready()) return

        event.preventDefault()
        await installStaged()
        await window.destroy()
        return
      }

      event.preventDefault()

      const answer = await prompt.choose({
        title: t('Save your changes?'),
        detail: t('{count} of your notes have unsaved changes.', {
          count: workspace.unsaved.length,
        }),
        options: [
          { id: 'save', label: t('Save'), primary: true },
          { id: 'discard', label: t('Discard'), danger: true },
          { id: 'cancel', label: t('Cancel') },
        ],
      })

      if (answer === 'save') await workspace.saveAll()
      else if (answer !== 'discard') return

      // Everything is either written or deliberately given up on.
      await installStaged()
      await window.destroy()
    })
  }

  /** Files named on the command line, and any handed over by a second launch. */
  async function openLaunchFiles() {
    if (!isDesktop) return

    for (const path of await invoke<string[]>('take_startup_files').catch(() => [])) {
      await workspace.open(path)
    }

    const { listen } = await import('@tauri-apps/api/event')
    void listen<string[]>('nib://open-files', async (event) => {
      for (const path of event.payload) await workspace.open(path)
    })
  }

  function runCommand(command: StateCommand) {
    if (!view) return
    command({ state: view.state, dispatch: (transaction: Transaction) => view!.dispatch(transaction) })
    view.focus()
  }

  async function paste() {
    if (!view) return
    const text = await navigator.clipboard.readText().catch(() => '')
    if (!text) return

    const range = view.state.selection.main
    view.dispatch({ changes: { from: range.from, to: range.to, insert: text } })
    view.focus()
  }

  /** The editor's own menu, so the browser's never appears. */
  function editorMenu(): MenuEntry[] {
    const selected = !!view && !view.state.selection.main.empty

    return [
      { label: t('Cut'), hint: 'Ctrl X', disabled: !selected, run: () => document.execCommand('cut') },
      { label: t('Copy'), hint: 'Ctrl C', disabled: !selected, run: () => document.execCommand('copy') },
      { label: t('Paste'), hint: 'Ctrl V', run: () => void paste() },
      DIVIDER,
      { label: t('Bold'), hint: 'Ctrl B', run: () => runCommand(toggleWrap('**')) },
      { label: t('Italic'), hint: 'Ctrl I', run: () => runCommand(toggleWrap('*')) },
      { label: t('Code'), run: () => runCommand(toggleWrap('`')) },
      { label: t('Link'), hint: 'Ctrl K', run: () => runCommand(insertLink) },
      { label: t('Clear formatting'), hint: 'Ctrl \\', run: () => runCommand(clearFormatting) },
      DIVIDER,
      { label: t('Quote'), run: () => runCommand(toggleQuote) },
      { label: t('Bulleted list'), run: () => runCommand(toggleBulletList) },
      { label: t('Numbered list'), run: () => runCommand(toggleOrderedList) },
      { label: t('Table'), hint: 'Ctrl T', run: () => view && insertTableToEdit(view) },
      { label: t('Code block'), run: () => runCommand(insertCodeFence) },
      { label: t('Horizontal rule'), run: () => runCommand(insertHorizontalRule) },
      { label: t('Page break'), run: () => runCommand(insertPageBreak) },
      DIVIDER,
      {
        label: modes.source ? t('Leave source mode') : t('Source mode'),
        hint: 'Ctrl /',
        run: () => modes.toggleSource(view),
      },
    ]
  }

  /** A pasted or dropped image, stored once however often it is pasted. */
  async function saveImage(file: File): Promise<string | null> {
    try {
      const src = await storeImage(file, workspace.active?.path ?? null)
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
    return imageUrl(src, workspace.active?.path, workspace.active?.doc ?? '')
  }

  async function toggleFullscreen() {
    if (!isDesktop) return
    const window = await currentWindow()
    await window.setFullscreen(!(await window.isFullscreen()))
  }

  function cycleTab(direction: number) {
    const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeTabId)
    if (index < 0) return

    const next = (index + direction + workspace.tabs.length) % workspace.tabs.length
    workspace.activate(workspace.tabs[next].id)
  }

  function onKeydown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey
    const shift = event.shiftKey

    if (event.key === 'F8') return act(event, () => modes.toggleFocus(view))
    if (event.key === 'F9') return act(event, () => modes.toggleTypewriter(view))
    if (event.key === 'F11') return act(event, () => void toggleFullscreen())
    if (!mod) return

    const key = event.key.toLowerCase()

    if (key === 'p' && !shift) return act(event, () => (palette = true))
    if (key === ',') return act(event, () => settings.show())
    if (key === '/') return act(event, () => modes.toggleSource(view))
    if (key === 's' && !shift) return act(event, () => void workspace.save())
    if (key === 'n' && !shift) return act(event, () => workspace.openBlank())
    if (key === 'o' && !shift) return act(event, () => void newSpace())
    if (key === 'w') return act(event, () => workspace.activeTabId && workspace.close(workspace.activeTabId))
    if (key === 'tab') return act(event, () => cycleTab(shift ? -1 : 1))

    if (!shift) return

    if (key === 'l') return act(event, () => workspace.toggleSidebar())
    if (key === '3') return act(event, () => workspace.showPanel('tree'))
    if (key === 'f') return act(event, () => workspace.showPanel('search'))
    if (key === '0') return act(event, () => modes.resetZoom())
    if (key === '=' || key === '+') return act(event, () => modes.stepZoom(1))
    if (key === '-' || key === '_') return act(event, () => modes.stepZoom(-1))
  }

  function act(event: KeyboardEvent, run: () => void) {
    event.preventDefault()
    run()
  }
</script>

<!-- Nothing in the app ever shows the browser's own menu. -->
<svelte:window onkeydown={onKeydown} oncontextmenu={(event) => event.preventDefault()} />

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
      class:dragging={drag !== null}
      class:settling={settle !== null}
      style:transform={drag === null || viewport.narrow ? undefined : `translateX(${drag - dragWidth}px)`}
      style:--settle={settle === null ? undefined : `${settle}ms`}
      ontransitionend={arrived}
    >
      <Rail
        {view}
        onpalette={() => (palette = true)}
        onhistory={() => (settings.historyOpen = true)}
      />

      {#if workspace.panel}
        <Sidebar ongoto={goto} />
      {/if}
    </div>

    {#if workspace.panel}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="scrim"
        class:dragging={drag !== null}
        style:opacity={drag === null || !dragWidth ? undefined : drag / dragWidth}
        onclick={() => workspace.showPanel(workspace.panel!)}
      ></div>
    {/if}

    <!-- On a phone too narrow for the drawer to leave any of the note showing,
         the layers swap: the list is the floor and the note is what moves,
         sliding off to the right to uncover it and back over it. The same
         drag drives both; only which layer it moves differs. -->
    <div
      class="document"
      class:open={!!workspace.panel}
      class:dragging={drag !== null}
      class:settling={settle !== null}
      style:transform={drag === null || !viewport.narrow ? undefined : `translateX(${drag}px)`}
      style:--settle={settle === null ? undefined : `${settle}ms`}
      ontransitionend={arrived}
    >
      <Titlebar onopennotes={() => (palette = true)} />

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="editor" oncontextmenu={(event) => menu.show(event, editorMenu())}>
        {#key workspace.activeTabId}
          <Editor
            bind:view
            doc={workspace.active?.doc ?? ''}
            onchange={(value) => workspace.edit(value)}
            onimage={saveImage}
            resolveimage={resolveImage}
            onselection={(current) => {
              formatBar?.follow(current)
              if (placed && placed === workspace.activeTabId) {
                workspace.noteView(placed, current.state.selection.main.head, current.scrollDOM.scrollTop)
              }
            }}
          />
        {/key}
      </div>

      <StatusBar doc={workspace.active?.doc ?? ''} />

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

{#if updateReady}
  <UpdateNotice version={updateReady} ondismiss={() => (updateReady = null)} />
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
