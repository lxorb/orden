<script lang="ts">
  import KindCard from './KindCard.svelte'
  import {
    fitsWhole,
    groupOf,
    kindLines,
    offeredKinds,
    type NewKindRow,
    showOthers,
  } from './new-kinds'
  import { kindOfLetter, letterIsOurs } from './new-kind-keys'
  import { overlays, roving } from '../../ui-kit/src/api'
  import { viewport } from '../../ui-kit/src/api'
  import { workspace } from '../../workspace/src/api'

  const { paneId, chosenOn }: { paneId: string; chosenOn?: string } = $props()

  const kinds = $derived(offeredKinds())
  const lines = $derived(kindLines(kinds))

  let room = $state({ width: 0, height: 0 })
  let card = $state({ width: 0, height: 0, gap: 0 })

  const whole = $derived(
    lines.length === kinds.length || fitsWhole(lines, room, card, viewport.touch),
  )
  const shown = $derived(whole ? lines : [lines.flatMap((line) => groupOf(line) ?? [])])

  function measure(here: HTMLElement) {
    const read = () => {
      const style = getComputedStyle(here)
      const first = here.querySelector<HTMLElement>('.line > button')
      room = {
        width: here.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: here.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      }
      if (first)
        card = {
          width: first.offsetWidth,
          height: first.offsetHeight,
          gap: parseFloat(style.rowGap) || 0,
        }
    }
    read()
    const watching = new ResizeObserver(read)
    watching.observe(here)
    return () => watching.disconnect()
  }

  function choosing() {
    if (chosenOn !== undefined) workspace.chosenOn(chosenOn)
  }

  function make(one: NewKindRow) {
    choosing()
    one.make(paneId)
  }

  function others(one: NewKindRow, card: Element | null | undefined): boolean {
    return !!card && showOthers(one, card, paneId, choosing)
  }

  function choose(event: MouseEvent, one: NewKindRow) {
    const chevron = event.target instanceof Element && event.target.closest('[data-more]')
    const card = event.currentTarget instanceof Element ? event.currentTarget : null
    if ((chevron || event.shiftKey || one.grouped) && others(one, card)) return
    make(one)
  }

  let element = $state<HTMLElement>()

  function taken(): boolean {
    const at = document.activeElement
    if (at && at !== document.body && !element?.contains(at)) return false

    element?.querySelector('button')?.focus()
    return true
  }

  $effect(() => {
    if (chosenOn !== undefined || workspace.panes.focusedId !== paneId) return
    if (taken()) return

    const until = performance.now() + 1000
    let frame = requestAnimationFrame(function again() {
      if (!taken() && performance.now() < until) frame = requestAnimationFrame(again)
    })
    return () => cancelAnimationFrame(frame)
  })

  function hears(): boolean {
    if (workspace.panes.focusedId !== paneId || overlays.depth > 0) return false
    if (chosenOn !== undefined && workspace.showing(paneId)?.id !== chosenOn) return false

    return letterIsOurs(document.activeElement, element?.closest('[data-pane]') ?? element ?? null)
  }

  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const one = kindOfLetter(kinds, event)
      if (!one || !hears()) return

      event.preventDefault()
      event.stopPropagation()
      const card = element?.querySelector(`[data-kind="${one.kind}"]`)
      if (event.shiftKey && others(one, card)) return
      make(one)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
</script>

<div
  class="here"
  bind:this={element}
  {@attach measure}
  data-new-here={paneId}
  data-grouped={whole ? undefined : ''}
  use:roving={{ across: !viewport.touch, rows: 'button', wrap: true }}
  role="group"
  aria-label="New tab"
>
  {#each shown as line (line[0]?.line)}
    <div class="line">
      {#each line as one, at (one.grouped ? one.line : one.kind)}
        <KindCard
          {one}
          letter={one.letter}
          rise={whole ? kinds.indexOf(one) : at}
          data-kind={one.grouped ? undefined : one.kind}
          data-group={one.grouped ? one.line : undefined}
          aria-haspopup={one.grouped ? 'menu' : undefined}
          aria-keyshortcuts={one.grouped ? undefined : one.letter.toUpperCase()}
          onclick={(event: MouseEvent) => choose(event, one)}
          onpointerenter={() => one.ready?.()}
          onfocus={() => one.ready?.()}
        />
      {/each}
    </div>
  {/each}
</div>

<style>
  .here {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    gap: var(--space-3);
    padding: var(--space-6);
    background: var(--empty-ground, var(--bg));
    overflow: auto;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
  }

  :global([data-touch]) .here,
  :global([data-touch]) .line {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: center;
  }

  :global([data-touch]) .line {
    width: 100%;
  }
</style>
