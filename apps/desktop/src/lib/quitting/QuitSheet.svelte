<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import Spark from '../agents/ui/Spark.svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { key, t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import TerminalMark from '../terminal/TerminalMark.svelte'
  import TickBox from '../TickBox.svelte'
  import { trap } from '../trap'
  import { quitAsk } from './state.svelte'

  const NAME = 'Orden'

  const title = $derived(
    quitAsk.why === 'quit'
      ? t('Quit {name}?', { name: NAME })
      : quitAsk.why === 'restart'
        ? t('Restart {name}?', { name: NAME })
        : t('Close window?'),
  )
  const going = $derived(
    quitAsk.why === 'quit'
      ? key('Quit anyway')
      : quitAsk.why === 'restart'
        ? key('Restart anyway')
        : key('Close anyway'),
  )

  const stay = () => quitAsk.answer('stay')

  $effect(() => closeOnBack(quitAsk.open, stay))
  $effect(() => (quitAsk.open ? overlays.show(stay) : undefined))
</script>

{#if quitAsk.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={stay}></div>

  <div
    class="orden-screen sheet"
    use:trap
    role="alertdialog"
    aria-modal="true"
    aria-label={title}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <p class="title">{title}</p>
    <p class="detail">{t('Running processes will stop.')}</p>

    <ul class="rows">
      {#each quitAsk.rows as row (`${row.window}:${row.id}`)}
        <li>
          <button
            type="button"
            class="orden-row is-short"
            class:is-idle={!row.busy}
            onclick={() => quitAsk.answer(row)}
          >
            {#if row.running}
              <TerminalMark tab={{ doc: row.doc ?? '', running: row.running }} />
            {:else}
              <Spark colour="currentColor" turning />
            {/if}
            <span class="name">{row.name}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="row">
      <TickBox
        label={t("Don't ask again")}
        checked={quitAsk.never}
        onchange={(on: boolean) => (quitAsk.never = on)}
      />
      <button type="button" class="orden-button is-quiet" data-lands onclick={stay}
        >{t('Cancel')}</button
      >
      <button type="button" class="orden-button is-danger" onclick={() => quitAsk.answer('go')}
        >{t(going)}</button
      >
    </div>
  </div>
{/if}

<style>
  .sheet {
    --screen-width: var(--screen-ask);

    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .detail {
    margin: calc(var(--space-4) * -1 + var(--space-1)) 0 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  .rows {
    list-style: none;
    margin: 0 calc(var(--row-pad) * -1);
    padding: 0;
    max-height: 40vh;
    overflow-y: auto;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .is-idle {
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
