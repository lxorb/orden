<script lang="ts">
  import { untrack } from 'svelte'
  import { basesOn } from '../settings.svelte'
  import { kitFor } from './kit'
  import { LiveView } from './live.svelte'
  import { fenceSource, fileSource, rowAt } from './source'
  import ViewFrame from './ViewFrame.svelte'

  const {
    code = null,
    file = null,
    view,
    from,
    stranger = false,
    title,
  }: {
    code?: string | null
    file?: string | null
    view?: string | undefined
    from: string | null
    stranger?: boolean
    title: string
  } = $props()

  const made = untrack(() => {
    const source =
      file !== null
        ? fileSource(file, view, () => rowAt(from))
        : fenceSource(code ?? '', from, stranger)
    const live = new LiveView(source)
    return { live, kit: kitFor(live, view === undefined ? {} : { view }, file, true) }
  })

  $effect(() => {
    if (basesOn()) return untrack(() => made.live.start())
  })
</script>

{#if basesOn()}
  <div class="base-block">
    <ViewFrame kit={made.kit} {title} />
  </div>
{/if}

<style>
  .base-block {
    margin: var(--space-2) 0;
    font-size: var(--text-row);
    white-space: normal;
  }
</style>
