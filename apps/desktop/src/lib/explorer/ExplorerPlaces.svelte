<script lang="ts">
  import { t } from '../i18n.svelte'
  import { roving } from '../roving'
  import { samePath, within } from '../space-paths'
  import { placeMark, placeName, places } from './places.svelte'
  import type { ExplorerView } from './view.svelte'

  const { view }: { view: ExplorerView } = $props()

  $effect(() => {
    void places.ask()
  })

  const here = $derived.by(() => {
    const folder = view.folder
    if (!folder) return null
    let best: string | null = null
    for (const one of places.list) {
      const holds = within(one.path, folder) !== null
      if (holds && (best === null || one.path.length > best.length)) best = one.path
    }
    return best
  })
</script>

<nav class="places" aria-label={t('Places')}>
  <ul use:roving={{ rows: '.place', current: '.place.is-on' }}>
    {#each places.list as place (place.path)}
      <li>
        <button
          class="nib-row place"
          class:is-on={here !== null && samePath(place.path, here)}
          title={place.path}
          onclick={() => view.go(place.path)}
        >
          <svg class="nib-row-mark" viewBox="0 0 24 24" aria-hidden="true">
            {#each placeMark(place) as [tag, attrs], index (index)}
              <svelte:element this={tag} {...attrs} />
            {/each}
          </svg>
          <span class="nib-row-label">{placeName(place)}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .places {
    flex: none;
    width: 12rem;
    padding: var(--space-1);
    overflow-y: auto;
    border-inline-end: 1px solid var(--line);
  }

  @container (max-width: 34rem) {
    .places {
      display: none;
    }
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
