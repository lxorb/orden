<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { chosenIcon } from './chosen-icon'
  import { faceOf, type FileMark as Mark, initialOf } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { readIcon } from './icons'
  import { longPress } from './longpress'
  import { middleOpens, type TabAsk, tabAsk } from './new-tab'

  const {
    path,
    name,
    mark,
    active,
    front,
    unloaded = false,
    slot,
    onopen,
    onmenu,
    ...rest
  }: {
    path: string
    name: string
    mark: Mark
    active: boolean
    front: boolean
    unloaded?: boolean
    slot: 'before' | 'after' | null
    onopen: (ask: TabAsk) => void
    onmenu: (event: MouseEvent) => void
  } & HTMLButtonAttributes = $props()

  const face = $derived(faceOf(mark, readIcon(chosenIcon(path)) !== null))
</script>

<button
  type="button"
  class="nib-tile tile"
  class:is-on={active}
  class:is-front={front}
  class:is-unloaded={unloaded}
  class:is-before={slot === 'before'}
  class:is-after={slot === 'after'}
  title={name}
  aria-label={name}
  draggable="true"
  onclick={(event) => onopen(tabAsk(event))}
  use:middleOpens={(event) => onopen(tabAsk(event))}
  oncontextmenu={onmenu}
  use:longPress={onmenu}
  {...rest}
>
  {#if face === 'letter'}
    <span class="nib-tile-letter" aria-hidden="true">{initialOf(name)}</span>
  {:else}
    <span class="nib-tile-face" aria-hidden="true"><FileMark {mark} {path} /></span>
  {/if}
</button>

<style>
  .tile.is-unloaded > span {
    opacity: 0.45;
  }
</style>
