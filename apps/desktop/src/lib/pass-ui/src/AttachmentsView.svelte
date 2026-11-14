<script lang="ts">
  import type { Item } from '@orden/pass/types'
  import { atLeast } from '@orden/pass/types'
  import Download from 'lucide/dist/esm/icons/download.mjs'
  import Paperclip from 'lucide/dist/esm/icons/paperclip.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { message } from '../../ui-kit/src/api'
  import { prompt } from '../../ui-kit/src/api'
  import { readableSize } from '../../usage.svelte'
  import { savedAttachment } from '../../pass-sync/src/api'
  import Glyph from './Glyph.svelte'
  import { pass } from '../../pass-sync/src/api'

  const { item }: { item: Item } = $props()

  let busy = $state<string | null>(null)
  let wrong = $state<string | null>(null)

  const role = $derived(pass.vaults.find((one) => one.id === item.vault)?.role ?? 'viewer')
  const editable = $derived(item.trashed === null && atLeast(role, 'editor'))

  async function download(id: string) {
    const attachment = item.attachments.find((one) => one.id === id)
    if (!attachment) return
    busy = id
    wrong = null
    try {
      await savedAttachment(attachment, await pass.fileBytes(item.id, id))
    } catch (error) {
      wrong = message(error, 'The file could not be opened.')
    } finally {
      busy = null
    }
  }

  async function remove(id: string, name: string) {
    const sure = await prompt.confirm({
      until: pass.opened,
      title: `Remove ${name}?`,
      detail: 'The file is deleted from this item.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!sure) return
    wrong = null
    try {
      await pass.detach(item.id, id)
    } catch (error) {
      wrong = message(error, 'The file could not be removed.')
    }
  }
</script>

{#if item.attachments.length}
  <section class="card" aria-label="Attachments">
    <h3 class="orden-section">Attachments</h3>
    {#each item.attachments as file (file.id)}
      <div class="line" data-file={file.name}>
        <Glyph icon={Paperclip} />
        <span class="name">{file.name}</span>
        <span class="meta">{readableSize(file.size)}</span>
        <button
          class="orden-glyph"
          type="button"
          aria-label="Download {file.name}"
          title="Download"
          aria-busy={busy === file.id}
          disabled={busy !== null}
          onclick={() => void download(file.id)}
        >
          <Glyph icon={Download} />
        </button>
        {#if editable}
          <button
            class="orden-glyph"
            type="button"
            aria-label="Remove {file.name}"
            title="Remove"
            onclick={() => void remove(file.id, file.name)}
          >
            <Glyph icon={X} />
          </button>
        {/if}
      </div>
    {/each}
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
  </section>
{/if}

<style>
  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > .orden-section {
    margin: 0;
    padding: var(--space-3) var(--space-3) var(--space-1);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    font-size: var(--text-row);
    color: var(--text);
  }

  .line + .line {
    border-top: 1px solid var(--line);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .wrong {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--danger);
  }
</style>
