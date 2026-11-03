<script lang="ts">
  /** Every tab as a window on a canvas, Alt Alt (issue #331).
   *
   *  Not a sheet of cards over the tabs: the tabs become the windows. The tab in front of
   *  each pane shrinks out of the pane, the others come down out of the strip from where
   *  each tab sits, and they land on a blurred canvas laid out the way the panes are - a
   *  split's sides side by side with a curve between them (layout.ts). A press on one
   *  opens it: it grows back into its pane while the rest go home to the strip. Alt Alt
   *  again, Escape, or a press on the canvas send every window home.
   *
   *  Every window is one element on springs from the tab it was to the window it is
   *  (flight.ts), so a change of mind mid-flight turns it round from where it is, at the
   *  speed it had. The springs write the styles themselves, once a frame, and nothing is
   *  laid out while anything flies. Asked for less movement, the windows are simply
   *  where they go. */

  import { untrack } from 'svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { t } from '../i18n.svelte'
  import { chorded } from '../keys'
  import { stillness } from '../motion'
  import { overlays } from '../overlays'
  import SpaceBadge from '../SpaceBadge.svelte'
  import { tabOverview } from '../surfaces.svelte'
  import TabMark from '../TabMark.svelte'
  import { trap } from '../trap'
  import { pages } from '../web-tab/pages.svelte'
  import { isUnsaved } from '../workspace/drafts'
  import { type Tab, workspace } from '../workspace.svelte'
  import { drawn, Flight, type Pose } from './flight'
  import { type Box, type Laid, lay, seamPath, type Slot } from './layout'
  import { marked, mirrorOf, shownBox } from './mirror'
  import { walk, wayOf } from './walk'
  import WindowFace from './WindowFace.svelte'

  /** Whether the layer is on screen at all: from the first frame out until the last
   *  window is home. */
  let shown = $state(false)
  /** Whether the windows are out on the canvas, or on their way home. */
  let out = $state(false)

  let width = $state(window.innerWidth)
  let height = $state(window.innerHeight)

  /** The room the windows are laid out in: the window, less a margin and the row of
   *  spaces at the top. */
  const MARGIN = 56
  const TOP = 88

  /** What each pane showed as the layer came up, which its windows take the shape of. */
  let panes = $state<Record<string, { w: number; h: number }>>({})
  /** The copy of each pane's tab in front, by tab. */
  let mirrors = $state<Record<string, HTMLElement>>({})

  const frame = $derived(workspace.panes.frame)
  const room = $derived<Box>({
    x: MARGIN,
    y: TOP,
    w: Math.max(width - 2 * MARGIN, 200),
    h: Math.max(height - TOP - MARGIN, 160),
  })

  const shapeOf = (paneId: string) => {
    const measured = shownBox(paneId)
    const box = panes[paneId] ?? (measured && { w: measured.width, h: measured.height })
    return box && box.w > 0 && box.h > 0 ? box.w / box.h : 16 / 10
  }

  const laid = $derived(
    lay(frame, room, {
      tabsOf: (paneId) => workspace.tabsIn(paneId).map((tab) => tab.id),
      shapeOf,
    }),
  )

  const byId = $derived(new Map(workspace.tabs.map((tab) => [tab.id, tab])))
  const windows = $derived(
    laid.slots.flatMap((slot) => {
      const tab = byId.get(slot.id)
      return tab ? [{ slot, tab }] : []
    }),
  )

  /** The size a pane's tab is drawn at inside its window: the pane's own. */
  function faceOf(slot: Slot) {
    const pane = panes[slot.paneId]
    if (pane && pane.w > 0) return { w: pane.w, h: pane.w * (slot.h / slot.w) }
    return { w: slot.w * 3, h: slot.h * 3 }
  }

  /** How far from its place, in pixels all told, a window's name starts to show. */
  const CAPTION_NEAR = 60

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const flights = new Map<string, Flight>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const elements = new Map<string, { window: HTMLElement; face: HTMLElement; chip: HTMLElement }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- written once a frame, never rendered
  const captions = new Map<string, HTMLElement>()

  /** Where a window goes home to: its pane, for the tab the pane shows, else its tab in
   *  the strip. A tab with no place on screen - scrolled out of its strip - fades where
   *  it is. */
  function homeOf(tab: Tab, slot: Slot): Pose {
    if (workspace.panes.at(tab.paneId)?.activeTabId === tab.id) {
      const box = shownBox(tab.paneId)
      if (box && box.width > 0)
        return { x: box.x, y: box.y, w: box.width, h: box.height, tab: 0, alpha: 1 }
    }
    // The tab's own shape in the strip; see Tabs.svelte.
    const chip = marked('box', tab.id)?.getBoundingClientRect()
    if (chip && chip.width > 0 && chip.right > 0 && chip.left < width) {
      return { x: chip.x, y: chip.y, w: chip.width, h: chip.height, tab: 1, alpha: 1 }
    }
    return { ...lifted(slot), alpha: 0 }
  }

  /** A slot as the pose of a window lying in it. */
  const lying = (slot: Slot): Pose => ({
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    tab: 0,
    alpha: 1,
  })

  /** A little smaller than its slot, where a window arrives from nowhere. */
  function lifted(slot: Slot): Pose {
    const less = 0.9
    return {
      x: slot.x + (slot.w * (1 - less)) / 2,
      y: slot.y + (slot.h * (1 - less)) / 2,
      w: slot.w * less,
      h: slot.h * less,
      tab: 0,
      alpha: 0,
    }
  }

  /** The keyboard's window, by tab. */
  let at = $state<string | null>(null)

  let frameAsked = 0
  let last = 0

  function fly() {
    if (frameAsked) return
    last = performance.now()
    frameAsked = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    frameAsked = 0
    const seconds = Math.max(0, (now - last) / 1000)
    last = now
    let moving = false
    for (const [id, flight] of flights) {
      if (!flight.step(seconds)) moving = true
      paint(id)
    }
    if (moving) fly()
    else if (!out) gone()
  }

  /** Writes a window's pose onto its element. */
  function paint(id: string) {
    const flight = flights.get(id)
    const parts = elements.get(id)
    const slot = laid.slots.find((one) => one.id === id)
    if (!flight || !parts || !slot) return
    const pose = flight.pose
    const styles = drawn(pose, slot.w, slot.h)
    Object.assign(parts.window.style, styles.window)
    Object.assign(parts.face.style, styles.face)
    Object.assign(parts.chip.style, styles.chip)
    // The name under a window only once it is nearly in its place.
    const caption = captions.get(id)
    if (caption) {
      const off =
        Math.abs(pose.x - slot.x) +
        Math.abs(pose.y - slot.y) +
        Math.abs(pose.w - slot.w) +
        Math.abs(pose.h - slot.h)
      const near = Math.max(0, 1 - off / CAPTION_NEAR)
      caption.style.opacity = String(near * Math.max(0, 1 - pose.tab * 3) * pose.alpha)
    }
  }

  /** Sends every window where it goes: onto the canvas, or home. */
  function aimAll() {
    for (const { slot, tab } of untrack(() => windows)) {
      const flight = flights.get(tab.id)
      flight?.aim(out ? lying(slot) : homeOf(tab, slot))
    }
    if (stillness()) {
      for (const [id, flight] of flights) {
        flight.land()
        paint(id)
      }
      if (!out) gone()
      return
    }
    fly()
  }

  /** The layer comes up: every pane measured and copied while it is still itself, the
   *  windows put where their tabs are, and sent out. */
  function enter() {
    const again = shown
    if (!again) {
      const measured: Record<string, { w: number; h: number }> = {}
      const copies: Record<string, HTMLElement> = {}
      for (const pane of workspace.panes.all) {
        const box = shownBox(pane.id)
        if (box) measured[pane.id] = { w: box.width, h: box.height }
        const tab = pane.activeTabId ? byId.get(pane.activeTabId) : undefined
        // A page is its photograph: the copy of a pane holding a live webview is a hole.
        if (tab && tab.kind !== 'web') {
          const copy = mirrorOf(pane.id)
          if (copy) copies[tab.id] = copy
        }
        if (tab?.kind === 'web') void pages.shoot(tab.id)
      }
      panes = measured
      mirrors = copies
      at = workspace.activeTabId
    }
    shown = true
    out = true
    tabOverview.out = workspace.tabs.map((tab) => tab.id)
    if (again) aimAll()
  }

  /** Every window home. */
  function leave() {
    out = false
    aimAll()
  }

  /** The last window is home: the layer goes and the strip has its tabs back. */
  function gone() {
    shown = false
    flights.clear()
    mirrors = {}
    tabOverview.out = []
  }

  const close = () => (tabOverview.open = false)

  $effect(() => {
    if (tabOverview.open) untrack(enter)
    else if (untrack(() => shown)) untrack(leave)
  })

  $effect(() => (shown && tabOverview.open ? overlays.show(close) : undefined))
  $effect(() => closeOnBack(shown && tabOverview.open, close))

  /** A window gets its flight the first time it is drawn: from its home on the way out,
   *  from nowhere for one that arrived while the layer was up. */
  function placed(node: HTMLElement, id: string) {
    const face = node.querySelector<HTMLElement>(':scope > .face-box')
    const chip = node.querySelector<HTMLElement>(':scope > .chip')
    if (!face || !chip) return
    elements.set(id, { window: node, face, chip })
    const entry = windows.find((one) => one.tab.id === id)
    if (entry && !flights.has(id)) {
      flights.set(id, new Flight(out ? homeOf(entry.tab, entry.slot) : lying(entry.slot)))
    }
    paint(id)
    aimAll()
    if (id === at) node.focus({ preventScroll: true })
    return {
      destroy() {
        elements.delete(id)
        flights.delete(id)
      },
    }
  }

  function captioned(node: HTMLElement, id: string) {
    captions.set(id, node)
    return {
      destroy() {
        captions.delete(id)
      },
    }
  }

  /** The layout changed under the windows - a resize, a space switched - so each goes to
   *  its new place from where it is. */
  $effect(() => relaid(laid))

  function relaid(now: Laid) {
    if (now.slots.length && untrack(() => shown)) untrack(aimAll)
  }

  /** A press on a window: the tab comes forward and its window grows back into the
   *  pane, while the others go home. */
  function open(tab: Tab) {
    workspace.activate(tab.id)
    close()
  }

  function keyed(event: KeyboardEvent) {
    const way = wayOf(event.key)
    if (!way || chorded(event)) return
    const from = windows.findIndex((one) => one.tab.id === at)
    const next =
      windows[
        walk(
          windows.map((one) => one.slot),
          Math.max(from, 0),
          way,
        )
      ]
    if (!next) return
    event.preventDefault()
    at = next.tab.id
    elements.get(next.tab.id)?.window.focus({ preventScroll: true })
  }

  const spaces = $derived(workspace.shownSpaces)
</script>

<svelte:window
  onresize={() => {
    width = window.innerWidth
    height = window.innerHeight
  }}
/>

{#if shown}
  <div class="nib-scrim ground" class:is-out={out} aria-hidden="true"></div>

  <div
    class="canvas"
    role="dialog"
    aria-modal="true"
    aria-label={t('Tabs')}
    tabindex="-1"
    use:trap
    onkeydown={keyed}
    onclick={(event) => {
      if (event.target === event.currentTarget) close()
    }}
  >
    {#if spaces.length > 1}
      <div class="spaces" class:is-out={out} role="group" aria-label={t('Spaces')}>
        {#each spaces as space (space.id)}
          <button
            class="space"
            class:is-on={space.id === workspace.activeSpaceId}
            aria-pressed={space.id === workspace.activeSpaceId}
            onclick={() => void workspace.selectSpace(space.id)}
          >
            <SpaceBadge {space} on={space.id === workspace.activeSpaceId} />
            <span class="space-name">{space.name}</span>
          </button>
        {/each}
      </div>
    {/if}

    <svg class="seams" class:is-out={out} {width} {height} aria-hidden="true">
      {#each laid.seams as seam (seam.id)}
        <path d={seamPath(seam)} />
      {/each}
    </svg>

    {#each windows as { slot, tab } (tab.id)}
      {@const face = faceOf(slot)}
      <button
        class="window"
        class:is-at={at === tab.id}
        class:unsaved={isUnsaved(tab.note)}
        style:width="{slot.w}px"
        style:height="{slot.h}px"
        aria-label={tab.shown}
        aria-current={tab.id === workspace.activeTabId ? 'page' : undefined}
        onfocus={() => (at = tab.id)}
        onclick={() => open(tab)}
        use:placed={tab.id}
      >
        <span class="face-box" style:scale={slot.w / face.w}>
          <WindowFace {tab} mirror={mirrors[tab.id] ?? null} width={face.w} height={face.h} />
        </span>
        <span class="chip" aria-hidden="true">
          <span class="chip-inner"><TabMark {tab} /><span class="chip-name">{tab.shown}</span></span
          >
        </span>
        <span class="ring" aria-hidden="true"></span>
      </button>
      <span
        class="caption"
        style:translate="{slot.x}px {slot.y + slot.h + 8}px"
        style:width="{slot.w}px"
        aria-hidden="true"
        use:captioned={tab.id}
      >
        <TabMark {tab} /><span class="caption-name">{tab.shown}</span>
      </span>
    {/each}
  </div>
{/if}

<style>
  /* The canvas: the app behind it, blurred far enough to be a surface and not a page. */
  .ground {
    --scrim-z: var(--z-sheet);
    --scrim-blur: 28px;
    --scrim-ink: 55%;
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
  }

  .ground.is-out {
    opacity: 1;
  }

  .canvas {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    overflow: hidden;
    outline: none;
  }

  .spaces {
    position: absolute;
    top: var(--space-6);
    left: 50%;
    display: flex;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-6));
    overflow-x: auto;
    translate: -50% -8px;
    opacity: 0;
    transition:
      opacity var(--dur-base) var(--ease-out),
      translate var(--dur-base) var(--ease-out);
  }

  .spaces.is-out {
    translate: -50% 0;
    opacity: 1;
  }

  .space {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    height: var(--row-height);
    padding: 0 var(--space-3) 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: calc(var(--row-height) / 2);
    color: var(--muted);
    background: color-mix(in srgb, var(--surface) 70%, transparent);
  }

  .space:hover {
    color: var(--text);
  }

  .space.is-on {
    color: var(--text-strong);
    border-color: var(--line);
    background: var(--surface);
  }

  .seams {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .seams.is-out {
    opacity: 1;
    transition-delay: var(--dur-base);
  }

  .seams path {
    fill: none;
    stroke: color-mix(in srgb, var(--accent) 55%, var(--muted));
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: none;
  }

  /* A window: no frame, floating. Laid out once at its slot's size at the canvas's
     corner; flight.ts moves and scales it from there. */
  .window {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0;
    border: 0;
    color: var(--text);
    font: inherit;
    text-align: start;
    overflow: hidden;
    transform-origin: 0 0;
    background: var(--bg);
    box-shadow: var(--shadow-lg);
    will-change: transform;
    cursor: pointer;
    outline: none;
  }

  .face-box {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }

  /* The tab it was, at the tab's own size whatever the window's scale. */
  .chip {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    transform-origin: 0 0;
    background: var(--tab-active, var(--surface));
    pointer-events: none;
  }

  .chip-inner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0 var(--space-3);
    color: var(--text);
    white-space: nowrap;
  }

  .chip-name,
  .caption-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A hairline round a window whose tab is somewhere in the file list, a dashed one round
     one that is nowhere yet; the accent round the keyboard's. */
  .ring {
    position: absolute;
    inset: 0;
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    border-radius: inherit;
    pointer-events: none;
  }

  .window.unsaved .ring {
    border: 1.5px dashed color-mix(in srgb, var(--muted) 75%, transparent);
  }

  .window:hover .ring {
    border-color: var(--line-strong);
  }

  .window.is-at:focus-visible .ring {
    border: 2px solid var(--accent);
  }

  .caption {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--text);
    font-size: var(--text-sm);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
  }
</style>
