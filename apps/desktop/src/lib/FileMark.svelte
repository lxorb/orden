<script lang="ts">
  import { isTermTarget } from '@orden/markdown/links'
  import { chosenIcon, chosenTint, faviconFor, sourceMark } from './chosen-icon'
  import { type FileMark, MARKS } from './file-mark'
  import Icon from './Icon.svelte'
  import { readIcon, takesTint } from './ui-kit/src/api'
  import { samePath } from './platform/src/api'
  import { terminalMark } from './surfaces.svelte'
  import { workspace } from './workspace.svelte'

  const {
    mark,
    path,
    url,
  }: {
    mark: FileMark
    path?: string | undefined
    url?: string | undefined
  } = $props()

  const chosen = $derived(path === undefined ? null : readIcon(chosenIcon(path)))
  const tint = $derived(path === undefined ? null : chosenTint(path))

  const term = $derived(
    path !== undefined && isTermTarget(path)
      ? (workspace.tabs.find((one) => one.path !== null && samePath(one.path, path)) ?? {
          doc: '',
          running: null,
          path,
        })
      : null,
  )

  const source = $derived(sourceMark(mark, path, url))
  const shown = $derived<FileMark>(source.mark)
  const worn = $derived(chosen ?? readIcon(source.icon))

  const favicon = $derived(mark === 'web' ? faviconFor(path, url) : null)

  let broken = $state(false)

  $effect(() => {
    if (favicon) broken = false
  })
</script>

{#if term}
  {#await terminalMark()}
    <span class="mark quiet"><Icon icon={worn} {tint} fallback={MARKS[shown]} /></span>
  {:then Mark}
    <Mark tab={term} />
  {:catch}
    <span class="mark quiet"><Icon icon={worn} {tint} fallback={MARKS[shown]} /></span>
  {/await}
{:else if favicon && !broken}
  <span class="mark picture" aria-hidden="true">
    <img src={favicon} alt="" draggable="false" onerror={() => (broken = true)} />
  </span>
{:else}
  <span class="mark" class:quiet={chosen === null || takesTint(chosen)}>
    <Icon icon={worn} {tint} fallback={MARKS[shown]} />
  </span>
{/if}

<style>
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    font-size: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  .quiet {
    opacity: 0.8;
  }

  .picture img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
