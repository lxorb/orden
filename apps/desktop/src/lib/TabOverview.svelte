<script lang="ts">
  /** Every tab of the space, pane by pane, as the Essentials' tiles: a press or Enter goes
   *  to one, the arrows walk, letters find a name, Escape puts it away. See
   *  SpacePicker.svelte. */
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { chorded } from './keys'
  import { LAYER } from './motion'
  import { overlays } from './overlays'
  import { roving } from './roving'
  import { tabOverview } from './surfaces.svelte'
  import { stillOf } from './tab-strip/thumb'
  import TabMark from './TabMark.svelte'
  import { trap } from './trap'
  import { pages } from './web-tab/pages.svelte'
  import { workspace } from './workspace.svelte'

  const close = () => (tabOverview.open = false)
  $effect(() => (tabOverview.open ? overlays.show(close) : undefined))
  $effect(() => closeOnBack(tabOverview.open, close))

  const tabs = $derived(workspace.panes.all.flatMap((pane) => workspace.tabsIn(pane.id)))

  /** How wide a web tab's still is made: the hover card's, so the two share one. */
  const STILL = 256

  /** Up and down, a row of the grid at a time: as many tiles as stand beside the first.
   *  Left and right are the list's own; see roving.ts. */
  const ROWS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 }

  function upDown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    const step = ROWS[event.key]
    const tiles = [...event.currentTarget.querySelectorAll<HTMLElement>('.nib-tile')]
    const across = tiles.filter((one) => one.offsetTop === tiles[0]?.offsetTop).length
    const at = tiles.findIndex((one) => one === document.activeElement)
    const next = step === undefined || chorded(event) ? undefined : tiles[at + step * across]
    if (!next) return
    event.preventDefault()
    next.focus()
  }
</script>

{#if tabOverview.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="nib-scrim" transition:fade={{ duration: LAYER.fade }} onclick={close}></div>

  <div
    class="nib-screen is-centred overview"
    role="dialog"
    aria-label={t('Tabs')}
    tabindex="-1"
    use:trap
    use:roving={{ rows: '.nib-tile', current: '.is-on', across: true, wrap: true }}
    onkeydown={upDown}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <div class="nib-tiles">
      {#each tabs as tab (tab.id)}
        {@const shot = tab.kind === 'web' ? pages.of(tab.id).shot : null}
        <button
          class="nib-tile"
          class:is-on={tab.id === workspace.activeTabId}
          data-lands={tab.id === workspace.activeTabId || undefined}
          onclick={() => {
            close()
            workspace.activate(tab.id)
          }}
        >
          <TabMark {tab} />
          {#if shot}
            {#await stillOf(tab.id, shot, STILL) then still}
              <img class="still" src={still} alt="" draggable="false" />
            {/await}
          {/if}
          <span class="name">{tab.shown}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* In the middle, as every layer; the tiles are the Essentials', larger. */
  .overview {
    --screen-width: var(--screen-panes);
    --tile-least: calc(4 * var(--space-7));
    --tile-height: calc(3 * var(--space-7));
    z-index: var(--z-sheet);
    overflow-y: auto;
  }

  /* The mark over the name, or a web tab's page as it was left over the mark. */
  .overview .nib-tile {
    grid-template-rows: 1fr var(--row-height);
  }

  .still {
    position: absolute;
    inset: var(--space-1) var(--space-1) auto;
    width: calc(100% - 2 * var(--space-1));
    height: calc(100% - var(--row-height) - var(--space-1));
    border-radius: var(--radius-sm);
    object-fit: cover;
    object-position: top;
  }

  .name {
    max-width: 100%;
    padding: 0 var(--space-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
