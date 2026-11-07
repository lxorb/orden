<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { unarchive } from './archiving'
  import { t } from './i18n.svelte'
  import { dur, slide } from './motion'
  import { ARCHIVE_MARK } from './archive-marks'

  const { path }: { path: string } = $props()
</script>

<div
  class="archived-strip"
  role="status"
  transition:slide={{ duration: dur(150), easing: cubicOut }}
>
  <svg viewBox="0 0 13 13" aria-hidden="true"><path d={ARCHIVE_MARK} /></svg>
  <span class="said">{t('Archived')}</span>
  <button class="back" onclick={() => unarchive(path)}>{t('Unarchive')}</button>
</div>

<style>
  .archived-strip {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .said {
    flex: 1;
    min-width: 0;
  }

  .back {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    font: inherit;
    font-weight: var(--weight-strong);
    color: var(--accent);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .back:hover {
    background: var(--accent-soft);
  }

  .back:active {
    transform: scale(0.97);
  }
</style>
