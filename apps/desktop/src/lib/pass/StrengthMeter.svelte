<script lang="ts">
  import { strengthOf, STRENGTH_BITS } from '@orden/pass/strength'
  import { strengthWord } from './strength-words'

  const { password }: { password: string } = $props()

  const judged = $derived(password === '' ? null : strengthOf(password))
  const filled = $derived(
    judged === null
      ? 0
      : Math.min(100, Math.round((judged.bits / (STRENGTH_BITS.strong + 30)) * 100)),
  )
</script>

<div class="strength" class:is-shown={judged !== null}>
  <div
    class="orden-meter"
    class:is-full={judged?.strength === 'vulnerable'}
    class:is-near={judged?.strength === 'weak'}
  >
    <div class="orden-meter-fill" style:width="{filled}%"></div>
  </div>
  {#if judged}
    <span class="word" data-strength={judged.strength}>{strengthWord(judged.strength)}</span>
  {/if}
</div>

<style>
  .strength {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 16px;
  }

  .orden-meter {
    flex: 1;
  }

  .word {
    flex: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .word[data-strength='vulnerable'] {
    color: var(--danger);
  }

  .word[data-strength='weak'] {
    color: var(--callout-warning);
  }

  .word[data-strength='strong'] {
    color: var(--success);
  }
</style>
