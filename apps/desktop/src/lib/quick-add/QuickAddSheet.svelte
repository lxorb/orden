<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../backstack.svelte'
  import { region } from '../region'
  import { fade, LAYER, scale } from '../motion'
  import { overlays } from '../overlays'
  import { trap } from '../trap'
  import { quickAdd } from './asked.svelte'
  import type { Entry } from './entry'
  import QuickAdd from './QuickAdd.svelte'
  import { links } from '../link-index.svelte'
  import { rows } from '../rows/rows.svelte'
  import { labelsOf } from '../views/task-meta'
  import { ai } from '../ai/store.svelte'
  import { addTask } from './write'

  let labels = $state<string[]>([])
  $effect(() => {
    if (!quickAdd.open) return
    labels = labelsOf(rows.shown())
    return rows.settled(() => (labels = labelsOf(rows.shown())))
  })

  $effect(() => (quickAdd.open ? overlays.show(() => quickAdd.hide()) : undefined))
  $effect(() => closeOnBack(quickAdd.open, () => quickAdd.hide()))

  async function added(entry: Entry, open: boolean): Promise<boolean> {
    const went = (await addTask(entry, { open })) !== null
    if (went && open) quickAdd.hide()
    return went
  }
</script>

{#if quickAdd.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="orden-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => quickAdd.hide()}
  ></div>
  <div
    class="orden-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label="Add task"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <QuickAdd
      langs={[region()]}
      tags={[...new Set([...links.spaceTags.map((one) => one.tag), ...labels])]}
      provider={ai.providerFor('ask')}
      prefill={quickAdd.prefill}
      smart={quickAdd.smart}
      onsubmit={added}
      onclose={() => quickAdd.hide()}
    />
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-screen);
  }

  .sheet {
    --screen-width: var(--screen-list);

    z-index: var(--z-screen);
  }
</style>
