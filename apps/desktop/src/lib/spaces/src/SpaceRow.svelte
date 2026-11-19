<script lang="ts">
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import { account } from '../../accounts/src/api'
  import { pieces } from '../../matching/src/api'
  import { SharedMark } from '../../ui-kit/src/api'
  import { isShared, roleOf } from '../../sharing/src/api'
  import SpaceBadge from './SpaceBadge.svelte'
  import { SpacePlace } from '../../space-pick/src/api'
  import { isNumber } from '../../space-pick/src/api'
  import { spaceSound } from './api'
  import { sync } from '../../sync-store/src/api'
  import type { Space } from '../../workspace/src/api'

  const {
    space,
    place,
    typed = '',
    held = false,
    on = false,
  }: { space: Space; place: number; typed?: string; held?: boolean; on?: boolean } = $props()

  const name = $derived(isNumber(typed) ? [{ text: space.name, hit: false }] : pieces(space.name, typed))
  const reads = $derived(roleOf(space.root) === 'read')
  const others = $derived.by(() => {
    const id = sync.remoteIdFor(space.root)
    return (id ? account.spaces.find((one) => one.id === id)?.people : undefined) ?? []
  })
</script>

<SpacePlace {place} {typed} {held}><SpaceBadge {space} {on} /></SpacePlace>
<span class="orden-row-label" dir="auto"
  >{#each name as piece, at (at)}{#if piece.hit}<b>{piece.text}</b>{:else}{piece.text}{/if}{/each}</span
>
{#if !__EVEN_PLUGIN__ && others.length}
  {#await import('../../accounts-ui/src/api') then ui}<ui.Faces ids={others} />{/await}
{/if}
{#if reads}
  <SharedMark icon={Eye} label="Read-only" />
{:else if isShared(space.root)}
  <SharedMark />
{/if}
{#if spaceSound.asked}
  {#await spaceSound.asked then Sound}<Sound id={space.id} />{/await}
{/if}

<style>
  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
</style>
