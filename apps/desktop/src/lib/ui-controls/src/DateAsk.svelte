<script lang="ts">
  import { untrack } from 'svelte'
  import { fade, LAYER } from '../../platform/src/api'
  import Calendar from './Calendar.svelte'
  import { todayIso } from './calendar'
  import { spendClick } from './spent-click'
  import TimeField from './TimeField.svelte'

  const {
    kind,
    value,
    at,
    onpick,
  }: {
    kind: 'date' | 'time'
    value: string
    at: DOMRect
    onpick: (value: string | null) => void
  } = $props()
  let clock = $state(untrack(() => value))
  function inSight(node: HTMLElement) {
    const box = node.getBoundingClientRect()
    const room = window.innerHeight - 8
    if (box.bottom > room) node.style.top = `${Math.max(8, room - box.height)}px`
    const wide = window.innerWidth - 8
    if (box.right > wide) node.style.left = `${Math.max(8, wide - box.width)}px`
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' && !(event.key === 'Tab' && kind === 'date')) return
    event.preventDefault()
    event.stopPropagation()
    onpick(null)
  }
</script>

<div
  class="orden-scrim is-clear catch"
  role="presentation"
  onpointerdown={(event) => {
    spendClick(event)
    onpick(null)
  }}
></div>
<div
  class="orden-layer ask"
  role="dialog"
  aria-label={kind === 'date' ? 'Choose a date' : 'Choose a time'}
  tabindex="-1"
  style:left="{at.left}px"
  style:top="{at.bottom + 4}px"
  use:inSight
  {onkeydown}
  transition:fade={{ duration: LAYER.fade }}
>
  {#if kind === 'date'}
    <Calendar {value} autofocus onpick={(iso: string) => onpick(iso)} />
    <div class="foot">
      <button type="button" class="orden-chip" onclick={() => onpick(todayIso())}>Today</button>
    </div>
  {:else}
    <form
      class="time"
      onsubmit={(event) => {
        event.preventDefault()
        onpick(clock || null)
      }}
    >
      <TimeField value={clock} label="Time" placeholder="9:30" autofocus onchange={(next: string) => (clock = next)} />
      <button type="submit" class="orden-chip">Set</button>
    </form>
  {/if}
</div>

<style>
  .catch {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-menu) - 1);
  }
  .ask {
    position: fixed;
    z-index: var(--z-menu);
    outline: none;
  }
  .foot {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-2);
  }
  .time {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 220px;
    padding: var(--space-2);
  }
</style>
