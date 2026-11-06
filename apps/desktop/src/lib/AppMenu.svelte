<script lang="ts">
  import { tick } from 'svelte'
  import type { EditorView } from '@orden/editor'
  import type { MenuGroup } from './menu-item'
  import { appMenuPanel, appMenuRows } from './surfaces.svelte'
  import { t } from './i18n.svelte'

  const {
    view,
    onpalette,
    onhistory,
    dots = false,
  }: {
    view?: EditorView | undefined
    onpalette: () => void
    onhistory: () => void
    dots?: boolean
  } = $props()

  let open = $state(false)
  let groups = $state<MenuGroup[]>([])

  async function show() {
    const [appMenu] = await Promise.all([appMenuRows(), appMenuPanel.ask()])
    await tick()

    groups = appMenu({ view, onpalette, onhistory })
    open = true
  }
</script>

<button
  class="nib-glyph trigger"
  data-opens="app-menu"
  class:dots
  title={t('Menu')}
  aria-label={t('Menu')}
  aria-expanded={open}
  onclick={() => (open ? (open = false) : void show())}
>
  {#if dots}
    <svg viewBox="0 0 16 16"
      ><circle cx="8" cy="3" r="1.35" /><circle cx="8" cy="8" r="1.35" /><circle
        cx="8"
        cy="13"
        r="1.35"
      /></svg
    >
  {:else}
    <svg viewBox="0 0 16 16"><path d="M1.5 4h13M1.5 8h13M1.5 12h13" /></svg>
  {/if}
</button>

{#if appMenuPanel.asked}
  {#await appMenuPanel.asked then AppMenuPanel}
    <AppMenuPanel bind:open {groups} />
  {/await}
{/if}

<style>
  .trigger {
    align-self: center;
  }

  .trigger.dots svg {
    fill: currentColor;
    stroke: none;
  }

  :global([data-touch]) .trigger {
    width: var(--touch-row);
    height: var(--touch-row);
  }

  :global([data-touch]) .trigger svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }
</style>
