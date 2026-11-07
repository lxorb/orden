<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { trap } from '../trap'
  import { crashReports } from './choice.svelte'

  crashReports.ask()

  let sending = $state(crashReports.on)

  const words = $derived(t('Send crash reports to help improve Orden'))

  const go = () => crashReports.answer(sending)

  $effect(() => (crashReports.asking ? overlays.show(go) : undefined))
</script>

{#if crashReports.asking}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="nib-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={go}></div>

  <div
    class="nib-screen is-centred sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={words}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <label class="tick">
      <input type="checkbox" class="nib-checkbox" bind:checked={sending} />
      <span>{words}</span>
    </label>
    <button type="button" class="nib-button" data-lands onclick={go}>{t('Continue')}</button>
  </div>
{/if}

<style>
  .sheet {
    --screen-width: var(--screen-ask);

    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .tick {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    text-wrap: balance;
    color: var(--text-strong);
  }

  .tick input {
    flex: none;
    margin: 0.2em 0 0;
  }

  button {
    align-self: flex-end;
  }
</style>
