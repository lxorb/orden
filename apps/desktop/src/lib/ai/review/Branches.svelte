<script lang="ts">
  import { t } from '../../i18n.svelte'
  import type { Thread } from '../chat/types'
  import { forkAt, switchBranch } from './branches'
  import type { ReviewPanel } from './review.svelte'

  const {
    thread,
    turn,
    panel = null,
  }: { thread: Thread; turn: string; panel?: ReviewPanel | null } = $props()

  const fork = $derived(forkAt(thread, turn))

  function step(by: number) {
    if (switchBranch(thread, turn, by)) panel?.touched?.(thread)
  }
</script>

{#if fork}
  <span class="branches">
    <button
      class="orden-glyph"
      disabled={fork.at === 0}
      title={t('Previous')}
      aria-label={t('Previous')}
      onclick={() => step(-1)}
    >
      <svg class="orden-mirror" viewBox="0 0 13 13"><path d="M8 3.2L4.7 6.5 8 9.8" /></svg>
    </button>
    <span class="count">{fork.at + 1}/{fork.count}</span>
    <button
      class="orden-glyph"
      disabled={fork.at === fork.count - 1}
      title={t('Next')}
      aria-label={t('Next')}
      onclick={() => step(1)}
    >
      <svg class="orden-mirror" viewBox="0 0 13 13"><path d="M5 3.2l3.3 3.3L5 9.8" /></svg>
    </button>
  </span>
{/if}

<style>
  .branches {
    display: inline-flex;
    align-items: center;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .orden-glyph {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .orden-glyph > svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }
</style>
