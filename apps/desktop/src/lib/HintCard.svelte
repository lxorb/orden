<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Cross from './Cross.svelte'
  import { type Hint, hints } from './hints.svelte'
  import { t } from './i18n.svelte'
  import { hang } from './portal'
  import { dur } from './motion'

  const {
    hint,
    text,
    when = true,
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
    hints.want(hint, when)
    return () => hints.want(hint, false)
  })

  function press() {
    hints.dismiss(hint)
    onpress?.()
  }
</script>

{#if hints.current === hint}
  <div
    class="nib-bubble is-pressable hint"
    role="status"
    use:hang={{ side, gap: 4, inset: '--space-2' }}
    transition:fly={{ y: side === 'above' ? 4 : -4, duration: dur(180), easing: cubicOut }}
  >
    <button class="say" onclick={press}>{text}</button>
    <button class="nib-glyph shut" aria-label={t('Dismiss')} onclick={() => hints.dismiss(hint)}>
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
