<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { Cross } from './ui-kit/src/api'
  import { type Hint, hints } from './hints.svelte'
  import { hang } from './ui-kit/src/api'
  import { dur, fly } from './platform/src/api'

  const {
    hint,
    text,
    when,
    side = 'above',
    onpress,
  }: {
    hint: Hint
    text: string
    when?: boolean
    side?: 'above' | 'below'
    onpress?: () => void
  } = $props()

  $effect(() => {
    hints.want(hint, hints.open(hint) && when !== false)
  })

  $effect(() => () => hints.want(hint, false))

  function press() {
    hints.dismiss(hint)
    onpress?.()
  }

  let bubble = $state<HTMLDivElement>()

  function busy(event: Event) {
    if (hints.current !== hint) return
    if (event.target instanceof Node && bubble?.contains(event.target)) return
    hints.aside(hint)
  }
</script>

<svelte:window onpointerdowncapture={busy} onkeydowncapture={busy} />

{#if hints.current === hint}
  <div
    bind:this={bubble}
    class="orden-bubble is-pressable hint"
    role="status"
    use:hang={{ side, gap: 4, inset: '--space-2' }}
    transition:fly={{ y: side === 'above' ? 4 : -4, duration: dur(180), easing: cubicOut }}
  >
    <button class="say" onclick={press}>{text}</button>
    <button class="orden-glyph shut" aria-label="Dismiss" onclick={() => hints.dismiss(hint)}>
      <Cross small />
    </button>
  </div>
{/if}

<style>
  .hint {
    position: fixed;
    z-index: calc(var(--z-popover) - 1);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .say {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
  }

  .shut {
    flex: none;
    width: 20px;
    height: 20px;
  }
</style>
