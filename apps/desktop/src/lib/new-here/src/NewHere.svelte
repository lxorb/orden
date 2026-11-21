<script lang="ts">
  import Sun from './Sun.svelte'
  import { type Picked, sunHand } from './sun-hand'
  import { Dial } from './dial.svelte'
  import { growInto } from './grow'
  import { kindLines, offeredKinds, type NewKindRow, showOthers } from './new-kinds'
  import { kindOfLetter, letterIsOurs } from './new-kind-keys'
  import { countsOf, slotsOf } from './sun-slots'
  import { MIDDLE, MIDDLE_KEY, RESTING, walked } from './sun-keys'
  import { overlays, viewport } from '../../ui-kit/src/api'
  import { isDesktop, stillness } from '../../platform/src/api'
  import { workspace } from '../../workspace/src/api'

  const { paneId, chosenOn }: { paneId: string; chosenOn?: string } = $props()
  const LEFT_BEHIND = 600
  const kinds = $derived(offeredKinds())
  const slots = $derived(slotsOf(kindLines(kinds)))
  const counts = $derived(countsOf(slots))
  const dial = new Dial()
  dial.aim = MIDDLE
  let element = $state<HTMLElement>()
  const hand = sunHand()
  let launching = $state(false)

  function choosing() {
    if (chosenOn !== undefined) workspace.chosenOn(chosenOn)
  }
  function placeOf(one: NewKindRow): [number, number] | null {
    for (const [slot, found] of slots.entries()) {
      const index = found?.kinds.indexOf(one) ?? -1
      if (found && index >= 0) return [slot, index]
    }
    return null
  }
  function optionElement(slot: number, index: number): Element | null {
    return element?.querySelector(`[data-slot="${slot}"] [data-index="${index}"]`) ?? null
  }
  function others(slot: number, index: number): boolean {
    const one = slots[slot]?.kinds[index]
    const anchor = optionElement(slot, index) ?? element?.querySelector(`[data-slot="${slot}"]`)
    return !!one && !!anchor && showOthers(one, anchor, paneId, choosing)
  }
  function cardOf(here: HTMLElement): HTMLElement | null {
    return here.closest('[data-pane]')?.querySelector<HTMLElement>(':scope > .card') ?? null
  }
  function leftBehind(): Promise<boolean> {
    const until = performance.now() + LEFT_BEHIND
    return new Promise((done) => {
      const look = () => {
        if (!element?.isConnected) done(true)
        else if (performance.now() > until) done(false)
        else requestAnimationFrame(look)
      }
      requestAnimationFrame(look)
    })
  }
  async function launch(slot: number, index: number) {
    const one = slots[slot]?.kinds[index]
    if (!one || launching) return
    launching = true
    dial.aim = { hub: false, open: slot, index }
    let growing: ReturnType<typeof growInto> | null = null
    const here = element
    if (!stillness() && !(isDesktop && one.paintedApart) && here) {
      await hand.settled(slot, index)
      const shape = hand.shapeOf(slot, index)
      const card = cardOf(here)
      if (shape && card && here.isConnected)
        growing = growInto(card, here, {
          ...shape,
          slot,
          index,
          accent: getComputedStyle(here).getPropertyValue('--accent').trim() || 'currentColor',
          ground: getComputedStyle(here).backgroundColor,
        })
    }
    choosing()
    one.make(paneId)
    const gone = growing ? await growing.arrived : await leftBehind()
    if (gone || !element?.isConnected) return
    dial.aim = RESTING
    launching = false
  }
  function pick(slot: number, index: number, how: Picked) {
    if (how === 'others' && others(slot, index)) return
    void launch(slot, index)
  }

  let claimed = false
  function taken(): boolean {
    const hub = element?.querySelector<HTMLElement>('.hub')
    if (!hub) return false
    const at = document.activeElement
    const claims = chosenOn !== undefined && !claimed && overlays.depth === 0
    if (!claims && at && at !== document.body && !element?.contains(at)) return false
    hub.focus({ preventScroll: true })
    claimed = document.activeElement === hub
    return claimed
  }
  function showingHere(): boolean {
    return chosenOn === undefined || workspace.showing(paneId)?.id === chosenOn
  }
  $effect(() => {
    if (workspace.panes.focusedId !== paneId || !showingHere()) return
    if (taken()) return
    const until = performance.now() + 1000
    let frame = requestAnimationFrame(function again() {
      if (!taken() && performance.now() < until) frame = requestAnimationFrame(again)
    })
    return () => cancelAnimationFrame(frame)
  })
  function hears(): boolean {
    if (launching || workspace.panes.focusedId !== paneId || overlays.depth > 0 || !showingHere()) return false
    return letterIsOurs(document.activeElement, element?.closest('[data-pane]') ?? element ?? null)
  }
  function steers(): boolean {
    const at = document.activeElement
    return at === null || at === document.body || at === document.documentElement || !!element?.contains(at)
  }
  function steer(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey || !steers()) return false
    if (event.key === MIDDLE_KEY) {
      if (event.repeat || event.shiftKey) return true
      dial.aim = MIDDLE
      return true
    }
    if (event.key === 'Escape') {
      if (!dial.hub && dial.open === null) return false
      dial.aim = RESTING
      return true
    }
    if (event.key === 'Enter') {
      const { open, index } = dial
      if (open === null) return false
      const count = counts[open] ?? 0
      if (index !== null) pick(open, index, event.shiftKey ? 'others' : 'click')
      else if (count === 1) pick(open, 0, event.shiftKey ? 'others' : 'click')
      return true
    }
    const next = walked(dial.aim, event.key, counts)
    if (next === null) return false
    dial.aim = next
    return true
  }
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !hears()) return
      if (steer(event)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const one = kindOfLetter(kinds, event)
      if (!one) return
      const place = placeOf(one)
      if (!place) return
      event.preventDefault()
      event.stopPropagation()
      pick(place[0], place[1], event.shiftKey ? 'others' : 'click')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
</script>

<div class="here" bind:this={element} data-new-here={paneId} role="group" aria-label="New tab">
  <div class="room">
    <Sun
      {slots}
      {dial}
      {hand}
      touch={viewport.touch}
      locked={launching}
      onpick={pick}
      onready={(one: NewKindRow) => one.ready?.()}
    />
  </div>
</div>

<style>
  .here {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--empty-ground, var(--bg));
    overflow: hidden;
    container-type: size;
  }
  .room {
    width: min(42rem, 100cqw, 100cqh);
  }
</style>
