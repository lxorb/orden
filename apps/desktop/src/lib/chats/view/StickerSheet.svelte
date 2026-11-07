<script lang="ts">
  import type { Sticker } from '@orden/chats/provider'
  import { t } from '../../i18n.svelte'
  import { remoteOf } from '../remotes'
  import type { ChatPage } from './chat.svelte'
  import Float from './Float.svelte'
  import { fileUrl } from './urls.svelte'

  const {
    page,
    kind,
    from,
    onclose,
  }: {
    page: ChatPage
    kind: 'stickers' | 'gifs'
    from: HTMLElement
    onclose: () => void
  } = $props()

  let query = $state('')
  let found = $state.raw<Sticker[]>([])
  const box = $derived.by(() => {
    const one = from.getBoundingClientRect()
    return { left: one.left, top: one.top, right: one.right, bottom: one.bottom }
  })

  $effect(() => {
    const connection = remoteOf(page.id)?.connection
    const asked = query.trim()
    let current = true
    const looking =
      kind === 'stickers'
        ? connection?.stickers?.().then((sets) => sets.flatMap((set) => set.stickers))
        : connection?.gifs?.(asked)
    void (looking ?? Promise.resolve([])).then(
      (list) => {
        if (current) found = list
      },
      () => {
        if (current) found = []
      },
    )
    return () => {
      current = false
    }
  })

  const shown = $derived(
    kind === 'stickers' && query.trim()
      ? found.filter(
          (one) =>
            one.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            one.emoji === query.trim(),
        )
      : found,
  )

  function send(one: Sticker) {
    page.sticker(one.ref)
    onclose()
  }
</script>

<Float at={box} label={kind === 'stickers' ? t('Sticker') : t('GIF')} width="300px" {onclose}>
  <div class="sheet">
    <input
      class="orden-field"
      type="search"
      bind:value={query}
      aria-label={t('Search')}
      placeholder={t('Search')}
    />
    <div class="grid">
      {#each shown as one (one.ref)}
        {@const url = fileUrl(page.id, one.ref)}
        <button
          type="button"
          class="one"
          aria-label={one.emoji ?? one.name}
          onclick={() => send(one)}
        >
          {#if url}<img src={url} alt="" draggable="false" />{/if}
        </button>
      {/each}
    </div>
  </div>
</Float>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
    max-height: 260px;
    overflow-y: auto;
  }

  .one {
    aspect-ratio: 1;
    padding: var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
  }

  @media (hover: hover) {
    .one:hover {
      background: var(--surface-hover);
    }
  }

  .one img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
