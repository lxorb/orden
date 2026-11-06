<script lang="ts">
  import { onMount } from 'svelte'
  import { account } from '../account.svelte'
  import { bridge } from './bridge.svelte'
  import { Frame, MOVE } from './frame.svelte'
  import { settings } from '../settings.svelte'
  import { viewport } from '../viewport.svelte'
  import { views } from '../views.svelte'
  import { workspace } from '../workspace.svelte'

  const voice = $derived(bridge.voiceState)

  const SCROLLED = 120

  const LEAST = 26

  interface Box {
    top: number
    left: number
    width: number
    height: number
    cut: boolean
  }

  let box = $state<Box | null>(null)
  const frame = new Frame()

  const showing = $derived(bridge.showing)

  let overlaid = $state(false)
  const covered = $derived(
    overlaid || settings.open || account.open || (viewport.drawer && !!workspace.panel),
  )

  interface Region {
    from: number
    to: number
  }

  function editor() {
    const tab = workspace.active
    if (tab?.kind !== 'note') return null

    return views.of(tab.paneId) ?? null
  }

  function measure(where: Region | null): Box | null {
    const view = editor()
    if (!view || !where) return null

    const rect = view.scrollDOM.getBoundingClientRect()
    const length = view.state.doc.length
    const top = view.documentTop
    const first = top + view.lineBlockAt(Math.min(where.from, length)).top
    const last = top + view.lineBlockAt(Math.max(0, Math.min(where.to, length) - 1)).bottom
    if (last <= rect.top || first >= rect.bottom) return null

    const shown = Math.max(first, rect.top)
    const bottom = Math.min(last, rect.bottom)
    return {
      top: shown,
      left: rect.left,
      width: rect.width,
      height: Math.max(LEAST, bottom - shown),
      cut: first < rect.top || last > rect.bottom,
    }
  }

  function atTop(): number | null {
    const view = editor()
    if (!view) return null

    const rect = view.scrollDOM.getBoundingClientRect()
    return view.posAtCoords({ x: rect.left + 8, y: rect.top + 4 }, false)
  }

  onMount(() => {
    let waiting: ReturnType<typeof setTimeout> | undefined
    let painting = 0
    let looping = 0
    let watched: HTMLElement | null = null
    let region: Region | null = null

    const paint = () => {
      box = measure(region ?? showing)
    }

    const remeasure = () => {
      if (looping) return

      cancelAnimationFrame(painting)
      painting = requestAnimationFrame(() => {
        painting = 0
        paint()
      })
    }

    const follow = () => {
      if (!frame.following) {
        looping = 0
        region = null
        paint()
        return
      }

      if (!bridge.steering) {
        const at = atTop()
        region = at === null ? null : bridge.regionAt(at)
      }

      paint()
      looping = requestAnimationFrame(follow)
    }

    const scrolled = () => {
      frame.scrolled()
      if (!looping) looping = requestAnimationFrame(follow)

      clearTimeout(waiting)
      waiting = setTimeout(() => {
        const at = atTop()
        if (at !== null) bridge.scrolled(at)
      }, SCROLLED)
    }

    const look = () => {
      overlaid = document.querySelector('.sheet, dialog[open], [role="dialog"]') !== null
    }

    const attach = () => {
      const found = editor()?.scrollDOM ?? null
      if (found === watched) return

      watched?.removeEventListener('scroll', scrolled)
      watched = found
      found?.addEventListener('scroll', scrolled, { passive: true })
      remeasure()
    }

    const every = setInterval(attach, 250)
    const watching = setInterval(look, 250)
    window.addEventListener('resize', remeasure)
    attach()
    look()

    let was = -1
    const turned = $effect.root(() => {
      $effect(() => {
        const page = showing?.page ?? -1
        if (page !== was) {
          was = page
          frame.turned()
        }

        remeasure()
      })
    })

    return () => {
      turned()
      clearInterval(every)
      clearInterval(watching)
      clearTimeout(waiting)
      frame.stop()
      cancelAnimationFrame(painting)
      cancelAnimationFrame(looping)
      window.removeEventListener('resize', remeasure)
      watched?.removeEventListener('scroll', scrolled)
    }
  })
</script>

<div
  hidden
  data-voice="{voice.path} {voice.on ? 'on' : 'off'} {String(voice.frames)} frames{voice.nothing
    ? ' nothing'
    : ''}{voice.trouble ? ` ${voice.trouble}` : ''}{voice.detail ? ` ${voice.detail}` : ''}"
  data-heard={voice.heard}
  data-took={voice.took
    ? `${String(voice.took.spoke)} spoke ${String(voice.took.hang)} hang ${String(voice.took.sent)} sent`
    : ''}
></div>

{#if box}
  <div
    class="frame"
    class:moving={frame.moving}
    class:cut={box.cut}
    class:gone={covered}
    aria-hidden="true"
    style:top="{box.top}px"
    style:left="{box.left}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:--move="{MOVE}ms"
  ></div>
{/if}

<style>
  .frame {
    position: fixed;
    z-index: var(--z-drawn);
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    border-radius: var(--radius-md);
    opacity: 0.5;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .moving {
    transition:
      top var(--move) var(--ease-spring),
      height var(--move) var(--ease-spring),
      opacity var(--dur-fast) var(--ease-out);
  }

  .cut {
    border-radius: 0;
    opacity: 0.35;
  }

  .gone {
    opacity: 0;
  }
</style>
