<script lang="ts">
  import { MOST_FILE_BYTES } from '@orden/pass/file-sizes'
  import type { Attachment } from '@orden/pass/types'
  import Paperclip from 'lucide/dist/esm/icons/paperclip.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { readableSize } from '../../usage.svelte'
  import type { Picked } from '../../pass-sync/src/api'
  import Glyph from './Glyph.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the lists are bindable, and a $props() pattern cannot be split */
  let {
    kept,
    adding = $bindable(),
    removing = $bindable(),
    oninput,
  }: {
    kept: Attachment[]
    adding: Picked[]
    removing: string[]
    oninput: () => void
  } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  let picker = $state<HTMLInputElement | null>(null)
  let over = $state(false)
  let wrong = $state<string | null>(null)

  const shown = $derived(kept.filter((one) => !removing.includes(one.id)))

  async function took(files: readonly File[]) {
    wrong = null
    const fitting = files.filter((one) => one.size <= MOST_FILE_BYTES)
    if (fitting.length < files.length) wrong = 'A file can be at most 100 MB.'
    const read = await Promise.all(
      fitting.map(async (one) => ({
        name: one.name,
        type: one.type,
        bytes: new Uint8Array(await one.arrayBuffer()),
      })),
    )
    if (!read.length) return
    adding = [...adding, ...read]
    oninput()
  }

  function chosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const files = [...(input.files ?? [])]
    input.value = ''
    void took(files)
  }

  function dropped(event: DragEvent) {
    event.preventDefault()
    over = false
    void took([...(event.dataTransfer?.files ?? [])])
  }

  function hovered(event: DragEvent) {
    event.preventDefault()
    over = true
  }
</script>

<section
  class="files"
  class:over
  aria-label="Attachments"
  ondragenter={hovered}
  ondragover={hovered}
  ondragleave={() => (over = false)}
  ondrop={dropped}
>
  {#if shown.length || adding.length}
    <div class="card">
      {#each shown as file (file.id)}
        <div class="line">
          <Glyph icon={Paperclip} />
          <span class="name">{file.name}</span>
          <span class="meta">{readableSize(file.size)}</span>
          <button
            class="orden-glyph"
            type="button"
            aria-label="Remove {file.name}"
            title="Remove"
            onclick={() => {
              removing = [...removing, file.id]
              oninput()
            }}
          >
            <Glyph icon={X} />
          </button>
        </div>
      {/each}
      {#each adding as file, index (index)}
        <div class="line is-new">
          <Glyph icon={Paperclip} />
          <span class="name">{file.name}</span>
          <span class="meta">{readableSize(file.bytes.length)}</span>
          <button
            class="orden-glyph"
            type="button"
            aria-label="Remove {file.name}"
            title="Remove"
            onclick={() => {
              adding = adding.filter((_, at) => at !== index)
              oninput()
            }}
          >
            <Glyph icon={X} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
  <input class="picker" type="file" multiple bind:this={picker} onchange={chosen} tabindex="-1" />
  <button
    class="orden-button is-quiet is-soft attach"
    type="button"
    onclick={() => picker?.click()}
  >
    <Glyph icon={Paperclip} />Attach file
  </button>
  {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
</section>

<style>
  .files {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-radius: var(--radius-md);
  }

  .files.over {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }

  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    font-size: var(--text-row);
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

  .picker {
    display: none;
  }

  .attach {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }
</style>
