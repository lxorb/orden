<script lang="ts">
  import type { Row } from '@orden/bases'
  import { i18n, t } from '../../i18n.svelte'
  import Cross from '../../Cross.svelte'
  import { workspace } from '../../workspace.svelte'
  import { noteText } from '../../workspace/note-text'
  import { addComment, deleteComment } from '../act'
  import { dateAt } from '../days'
  import { type Comment, commentsOf } from '../task-body'
  import Words from '../Words.svelte'
  import { grow } from '../../grow'
  import Glyph from '../../quick-add/Glyph.svelte'
  import Message from 'lucide/dist/esm/icons/message-square.mjs'

  const {
    row,
    path,
    writable = true,
  }: {
    row: Row
    path: string
    writable?: boolean
  } = $props()

  let comments = $state.raw<Comment[]>([])
  let words = $state('')
  let field = $state<HTMLTextAreaElement>()

  $effect(() => {
    const now = row
    const anchor = now.anchor
    if (!anchor) return
    let gone = false
    void noteText(workspace, path).then((text) => {
      if (!gone) comments = text === null ? [] : commentsOf(text, anchor)
    })
    return () => (gone = true)
  })

  function when(at: string): string {
    const [day = '', time = ''] = at.split('T')
    const date = dateAt(day)
    if (Number.isNaN(date.getTime())) return at
    const [hours = 0, minutes = 0] = time.split(':').map(Number)
    date.setHours(hours, minutes)
    return i18n.when(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  let sending = false
  async function send() {
    const said = words.trim()
    if (!said || sending) return
    sending = true
    try {
      if ((await addComment(row, said)) && words.trim() === said) words = ''
    } finally {
      sending = false
    }
  }

  export function focus() {
    field?.focus()
  }
</script>

<div class="comments">
  {#if comments.length}
    <p class="orden-section">{t('Comments')}</p>
  {/if}
  {#each comments as one (one.line)}
    <div class="comment">
      <div class="said"><Words words={one.text} /></div>
      {#if one.at}<span class="at">{when(one.at)}</span>{/if}
      {#if writable}<button
          type="button"
          class="orden-glyph gone"
          aria-label={t('Delete')}
          title={t('Delete')}
          onclick={() => void deleteComment(row, one.line)}><Cross /></button
        >{/if}
    </div>
  {/each}
  {#if writable}
    <label class="orden-row orden-field composer-row">
      <span class="orden-row-mark"><Glyph icon={Message} /></span>
      <textarea
        bind:this={field}
        bind:value={words}
        use:grow={words}
        class="composer"
        rows="1"
        aria-label={t('Comment')}
        placeholder={t('Comment')}
        onkeydown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            void send()
          } else if (event.key === 'Escape' && words) {
            event.stopPropagation()
            words = ''
          }
        }}></textarea>
    </label>
  {/if}
</div>

<style>
  .comments {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .comment {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--text);
  }

  .said {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .at {
    flex: none;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .gone {
    flex: none;
    align-self: center;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .comment:hover .gone,
  .gone:focus-visible {
    opacity: 1;
  }

  :global([data-touch]) .gone {
    opacity: 1;
  }

  .composer-row {
    align-items: flex-start;
    padding-inline: calc(var(--row-pad) - 1px);
    border-color: transparent;
    color: var(--muted);
    cursor: text;
  }

  .composer-row:not(:hover, :focus-within) {
    background: none;
  }

  .composer-row .orden-row-mark {
    height: calc(var(--row-height) - 2px);
  }

  .composer-row .composer {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: calc((var(--row-height) - 2px - var(--text-row) * var(--leading-row)) / 2) 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
    line-height: var(--leading-row);
    resize: none;
    field-sizing: content;
    min-height: calc(var(--row-height) - 2px);
    max-height: 30vh;
    outline: none;
  }

  .composer::placeholder {
    color: var(--muted);
  }

  .composer-row:focus-within {
    background: var(--surface-hover);
  }
</style>
