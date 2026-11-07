<script lang="ts">
  import { fileMark } from '../file-mark'
  import FileMark from '../FileMark.svelte'
  import { plural, t } from '../i18n.svelte'
  import { identifier } from '../identifier'
  import { readableSize } from '../usage.svelte'
  import { when } from '../when'
  import {
    cancelJob,
    type Count,
    countIn,
    type Entry,
    type Facts,
    factsOf,
    peekAt,
  } from './commands'
  import { mediaUrl, MOST_MEDIA, MOST_TEXT, shownAs, textOf } from './preview'
  import type { ExplorerView } from './view.svelte'

  const { view, large = false }: { view: ExplorerView; large?: boolean } = $props()

  const entry = $derived<Entry | null>(
    view.picked.cursor === null
      ? null
      : (view.rows.find((one) => one.name === view.picked.cursor) ?? null),
  )
  const path = $derived(entry ? view.pathOf(entry.name) : (view.listing?.path ?? null))

  let facts = $state<Facts | null>(null)
  let media = $state<{ shown: 'picture' | 'sound' | 'film'; url: string } | null>(null)
  let text = $state<{ words: string; cut: boolean } | null>(null)
  let count = $state<Count | null>(null)
  let counting = $state<string | null>(null)

  $effect(() => {
    const at = path
    const shown = entry
    facts = null
    media = null
    text = null
    count = null
    if (!at) return
    let gone = false
    let url: string | null = null
    void factsOf(at)
      .then((found) => {
        if (!gone) facts = found
      })
      .catch(() => undefined)
    const as = shown && !shown.folder ? shownAs(shown.name, shown.size) : null
    if (shown && as === 'text') {
      void peekAt(at, MOST_TEXT)
        .then((read) => {
          const words = textOf(read.bytes)
          if (!gone && words !== null) text = { words, cut: read.cut }
        })
        .catch(() => undefined)
    } else if (shown && as !== null && as !== 'text') {
      const kind = as
      void peekAt(at, MOST_MEDIA)
        .then((read) => {
          url = mediaUrl(shown.name, read)
          if (gone && url) URL.revokeObjectURL(url)
          else if (url) media = { shown: kind, url }
        })
        .catch(() => undefined)
    }
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
      if (counting) void cancelJob(counting)
      counting = null
    }
  })

  function countNow() {
    const at = path
    if (!at || counting) return
    const job = identifier()
    counting = job
    void countIn(job, at)
      .then((found) => {
        if (counting === job && !found.cancelled) count = found
      })
      .catch(() => undefined)
      .finally(() => {
        if (counting === job) counting = null
      })
  }
</script>

<section class="preview" class:large aria-label={t('Preview')}>
  <div class="shown">
    {#if media?.shown === 'picture'}
      <img src={media.url} alt={entry?.name ?? ''} draggable="false" />
    {:else if media?.shown === 'sound'}
      <audio src={media.url} controls></audio>
    {:else if media?.shown === 'film'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={media.url} controls></video>
    {:else if text}
      <pre class="words">{text.words}</pre>
    {:else}
      <span class="big">
        <FileMark mark={!entry || entry.folder ? 'folder' : fileMark(entry.name)} />
      </span>
    {/if}
  </div>
  {#if facts}
    <h3 class="named">{entry ? entry.name.split('/').at(-1) : (view.listing?.path ?? '')}</h3>
    <dl>
      {#if !facts.folder}
        <dt>{t('Size')}</dt>
        <dd>{readableSize(facts.size)}</dd>
      {/if}
      <dt>{t('Modified')}</dt>
      <dd>{when(facts.modified, 'medium')}</dd>
      {#if facts.created}
        <dt>{t('Created')}</dt>
        <dd>{when(facts.created, 'medium')}</dd>
      {/if}
      {#if facts.mode}
        <dt>{t('Permissions')}</dt>
        <dd class="mono">{facts.mode}</dd>
      {/if}
      {#if facts.link}
        <dt>{t('Link to')}</dt>
        <dd class="path">{facts.link}</dd>
      {/if}
      <dt>{t('Path')}</dt>
      <dd class="path">{facts.path}</dd>
    </dl>
    {#if facts.folder}
      {#if count}
        <p class="count">
          {t('{files}, {folders}, {size}', {
            files: plural(count.files, { one: '{count} file', other: '{count} files' }),
            folders: plural(count.folders, { one: '{count} folder', other: '{count} folders' }),
            size: readableSize(count.bytes),
          })}
        </p>
      {:else}
        <button type="button" class="nib-button is-quiet" onclick={countNow} disabled={!!counting}
          >{counting ? t('Counting…') : t('Count what it holds')}</button
        >
      {/if}
    {/if}
  {/if}
</section>

<style>
  .preview {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-3);
    width: 18rem;
    padding: var(--space-3);
    overflow-y: auto;
    border-inline-start: 1px solid var(--line);
    font-size: var(--text-sm);
  }

  .preview.large {
    width: 100%;
    height: 100%;
    border: none;
  }

  @container (max-width: 40rem) {
    .preview:not(.large) {
      display: none;
    }
  }

  .shown {
    display: grid;
    place-items: center;
    min-height: 8rem;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .large .shown {
    flex: 1;
    min-height: 0;
  }

  .shown img,
  .shown video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .shown audio {
    width: 100%;
  }

  .words {
    align-self: stretch;
    justify-self: stretch;
    max-height: 20rem;
    margin: 0;
    padding: var(--space-2);
    overflow: auto;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .large .words {
    max-height: none;
    height: 100%;
  }

  .big :global(.mark) {
    width: 48px;
    height: 48px;
  }

  .named {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    word-break: break-word;
    unicode-bidi: isolate;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    color: var(--text);
  }

  .path {
    word-break: break-all;
    unicode-bidi: isolate;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .count {
    margin: 0;
    color: var(--text);
  }
</style>
