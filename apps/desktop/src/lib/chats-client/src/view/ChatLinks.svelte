<script lang="ts">
  import FileMark from '../../../FileMark.svelte'
  import { nameOf as fileName, relativeTo, withoutExtension } from '../../../platform/src/api'
  import { workspace } from '../../../workspace.svelte'
  import type { Hit } from '../shapes'
  import { firstLine } from './body'
  import { openChat } from './open'
  import { store } from './source.svelte'

  const { path }: { path: string } = $props()

  let hits = $state.raw<Hit[]>([])
  let heard = $state(0)

  $effect(() => store().heard(() => heard++))

  const follows = (_value: unknown) => undefined

  $effect(() => {
    const root = workspace.rootHolding(path)
    const names = [withoutExtension(fileName(path))]
    if (root) names.push(withoutExtension(relativeTo(root, path)))
    follows(heard)
    let current = true
    void store()
      .linking(names)
      .then((found) => {
        if (current) hits = found.filter((one) => !one.message.deleted)
      })
    return () => {
      current = false
    }
  })

  function open(hit: Hit) {
    const at = store().entry(hit.chat)?.path
    if (at) openChat(at, {}, hit.message.id)
  }
</script>

{#if hits.length}
  <p class="orden-section">Chats<span>{hits.length}</span></p>
  {#each hits as hit (hit.message.id)}
    <button type="button" class="orden-row" onclick={() => open(hit)}>
      <FileMark mark="chat" path={store().entry(hit.chat)?.path ?? undefined} />
      <span class="orden-row-label">{firstLine(hit.message.body)}</span>
      <span class="where">#{store().entry(hit.chat)?.name ?? ''}</span>
    </button>
  {/each}
{/if}

<style>
  .where {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
