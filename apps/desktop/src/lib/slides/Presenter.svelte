<script lang="ts">
  import { keyElsewhere } from '../layer-keys'
  import { onDestroy } from 'svelte'
  import { fitSurface } from './fit'
  import { leads, presenterChannel, type Lead, type Stage } from './presenter'
  import { STAGE_HEIGHT, stageScale, STAGE_WIDTH } from './stage'

  let stage = $state<Stage | null>(null)
  let gone = $state(false)
  let elapsed = $state(0)

  let big = $state<HTMLElement>()
  let small = $state<HTMLElement>()
  let bigPage = $state<HTMLElement>()
  let smallPage = $state<HTMLElement>()

  const ALONE = 600

  let lead: Lead | null = null
  let alone: ReturnType<typeof setTimeout> | undefined

  const channel = presenterChannel((message) => {
    if (message.kind === 'stage') {
      if (!leads(lead, message.show, message.took)) return
      lead = { show: message.show, took: message.took }
      clearTimeout(alone)
      stage = message.stage
      document.documentElement.dataset.theme = message.stage.scheme
      return
    }

    if (message.kind === 'gone' && message.show === lead?.show) {
      lead = null
      channel.send({ kind: 'here' })
      clearTimeout(alone)
      alone = setTimeout(() => {
        if (lead) return
        gone = true
        window.close()
      }, ALONE)
    }
  })

  channel.send({ kind: 'here' })

  onDestroy(() => {
    clearTimeout(alone)
    channel.close()
  })

  $effect(() => {
    const from = stage?.started
    if (from === undefined) return

    const tick = () => (elapsed = Math.max(0, Math.floor((Date.now() - from) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  })

  const clock = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`)

  function scaleInto(box: HTMLElement | undefined) {
    if (!box) return

    box.style.setProperty('--stage-scale', String(stageScale(box.clientWidth, box.clientHeight)))
  }

  $effect(() => {
    const boxes = [big, small]
    for (const box of boxes) scaleInto(box)

    const watcher = new ResizeObserver(() => {
      for (const box of boxes) scaleInto(box)
    })
    for (const box of boxes) if (box) watcher.observe(box)
    return () => watcher.disconnect()
  })

  function fitBoth() {
    if (bigPage) fitSurface(bigPage)
    if (smallPage) fitSurface(smallPage)
  }

  $effect(() => {
    const reasons = [stage?.slide, stage?.next]
    if (!reasons.length) return

    fitBoth()
    void document.fonts.ready.then(fitBoth)
  })

  function move(by: number) {
    if (lead) channel.send({ kind: 'move', show: lead.show, by })
  }

  function onKeydown(event: KeyboardEvent) {
    if (keyElsewhere(event)) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        event.preventDefault()
        move(1)
        return
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault()
        move(-1)
        return
      default:
        return
    }
  }

  const style = `--stage-width: ${STAGE_WIDTH}px; --stage-height: ${STAGE_HEIGHT}px`
</script>

<svelte:window onkeydown={onKeydown} />

{#if stage && !gone}
  <div class="presenter" {style} onloadcapture={fitBoth}>
    <div class="screens">
      <div class="frame deck-frame now" bind:this={big}>
        <div class="stage">
          <div class="slide" data-shape={stage.shape}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- the slide the stage sent, already rendered by it -->
            <div class="orden-write" bind:this={bigPage}>{@html stage.slide}</div>
          </div>
        </div>
      </div>

      <div class="frame deck-frame then" bind:this={small}>
        <div class="stage">
          <div class="slide" data-shape={stage.nextShape}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- the next slide, from the same place -->
            <div class="orden-write" bind:this={smallPage}>{@html stage.next}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="aside">
      <div class="bar">
        <span class="clock">{clock}</span>
        <span class="at">{stage.at}/{stage.count}</span>
      </div>
      <div class="notes">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, the part only this window shows -->
        {@html stage.notes}
      </div>
    </div>
  </div>
{/if}

<style>
  .presenter {
    display: grid;
    grid-template-columns: 1fr minmax(240px, 32%);
    gap: var(--space-4);
    height: 100dvh;
    padding: var(--space-4);
    box-sizing: border-box;
    background: var(--bg);
  }

  .screens {
    display: grid;
    grid-template-rows: 2fr 1fr;
    gap: var(--space-4);
    min-width: 0;
    min-height: 0;
  }

  .frame {
    position: relative;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .frame.then {
    opacity: 0.62;
  }

  .aside {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--font-ui);
    font-variant-numeric: tabular-nums;
  }

  .clock {
    font-size: 1.9rem;
    color: var(--text-strong);
    letter-spacing: -0.02em;
  }

  .at {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .notes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-family: var(--font-content);
    font-size: 1.1rem;
    line-height: 1.6;
    color: var(--text);
  }

  .notes :global(> :first-child) {
    margin-top: 0;
  }

  .notes :global(> :last-child) {
    margin-bottom: 0;
  }
</style>
