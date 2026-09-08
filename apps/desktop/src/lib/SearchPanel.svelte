<script lang="ts">
  /** The Search panel: a field that understands operators, the lines they
   *  found, and a replacement to run over the ones that are ticked.
   *
   *  What is asked and what came back live in the search store, because a
   *  bookmarked search runs from the row above the file list. What is here is
   *  the field, the popup that finishes an operator's value, and the rows. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { search } from './search.svelte'
  import { chosen, completing, nearest, offered } from './search/suggest'
  import type { Hit, Range } from './search/match'
  import { relativeTo } from './space-paths'
  import Suggest from './Suggest.svelte'
  import { nodesIn, tagTree } from './tag-tree'
  import TagTree from './TagTree.svelte'
  import { type Entry, workspace } from './workspace.svelte'

  const { ongoto }: { ongoto?: ((line: number) => void) | undefined } = $props()

  /** A star: the mark bookmarking wears wherever it is not a word. */
  const STAR =
    'M6.5 1.6l1.55 3.14 3.47.5-2.51 2.45.59 3.45L6.5 9.5 3.4 11.14l.59-3.45L1.48 5.24l3.47-.5z'

  /** Two rows and an arrow between them: one word standing in for another. */
  const SWAP = 'M1.8 4h7.4M7.4 2.2 9.2 4 7.4 5.8M11.2 9H3.8M5.6 7.2 3.8 9l1.8 1.8'

  const TICK = 'M2.6 6.6 5 9l5.4-5.4'

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  let field = $state<HTMLInputElement>()
  let focused = $state(false)
  /** Set by Escape, so a popup that was shut stays shut until the next
   *  keystroke asks for it again. */
  let shut = $state(false)
  let caret = $state(0)
  let active = $state(0)

  /** The folders of the space, as `path:` writes them. */
  const folders = $derived.by(() => {
    const root = workspace.activeSpace?.root
    const tree = workspace.tree
    if (!root || !tree) return []

    const out: string[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (!child.is_dir) continue

        out.push(`${relativeTo(root, child.path).replace(/\\/g, '/')}/`)
        walk(child)
      }
    }

    walk(tree)
    return out.sort()
  })

  const names = $derived([...new Set(workspace.notes.map((note) => stripped(note.name)))].sort())

  /** The space's tags as the tree their slashes describe. */
  const tags = $derived(tagTree(workspace.tags))

  /** Every node of it, by path, which is what `tag:` is finished with: a path is
   *  what the operator takes, and every node of the tree is one, so `tag:nib`
   *  offers `work/nib` as well as the tags spelled that way. */
  const tagPaths = $derived(nodesIn(tags).map((node) => node.path))

  /** What the caret is finishing, and what the space has to finish it with.
   *  Only while the field has the focus: a popup over a panel nobody is
   *  typing in is in the way. */
  const asking = $derived(focused && !shut ? completing(search.text, caret) : null)

  const suggestions = $derived.by(() => {
    if (!asking) return []
    // A tag path is deep and long, so it is the one value worth finding by a
    // handful of its letters: `wnc` offers `work/nib/canvas`. The same scorer the
    // hit list ranks with; see search/fuzzy.ts.
    if (asking.field === 'tag') return nearest(asking.typed, tagPaths)
    return offered(asking.typed, asking.field === 'path' ? folders : names)
  })

  // A question asked of another space is not this space's question. The panel
  // is rebuilt for each space, so this says which one it is showing.
  $effect(() => {
    search.forSpace(workspace.activeSpace?.root ?? null)
  })

  /** Reads a value for its own sake, so the effect around it follows that
   *  value. Nothing wants the value itself. */
  const follows = (_value: unknown) => undefined

  // A fresh list starts at the top: the row the arrow pointed at is no longer
  // the one under it.
  $effect(() => {
    follows(suggestions)
    active = 0
  })

  /** The search in the box, as something to keep. */
  const searchMark = $derived(search.asks ? workspace.bookmarks.forSearch(search.text) : null)

  /** Consecutive hits from one note read as that note's hits, with its name
   *  said once above them. */
  const groups = $derived.by(() => {
    const out: { path: string; name: string; loose: boolean; hits: Hit[] }[] = []

    for (const hit of search.hits) {
      const last = out.at(-1)
      if (last?.path === hit.path) last.hits.push(hit)
      // A score is what a loose match has and an exact one has not; see fuzzy.ts.
      else out.push({ path: hit.path, name: hit.name, loose: hit.score !== undefined, hits: [hit] })
    }

    return out
  })

  /** One line cut into what matched and what did not, so the match can be
   *  emphasised without any markup in the string itself. */
  function pieces(text: string, ranges: Range[]) {
    const out: { text: string; mark: boolean }[] = []
    let at = 0

    for (const range of ranges) {
      if (range.from > at) out.push({ text: text.slice(at, range.from), mark: false })
      out.push({ text: text.slice(range.from, range.to), mark: true })
      at = range.to
    }

    if (at < text.length) out.push({ text: text.slice(at), mark: false })
    return out
  }

  function typing(event: Event & { currentTarget: HTMLInputElement }) {
    caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    shut = false
    search.ask(event.currentTarget.value)
  }

  function take(value: string) {
    if (!asking) return

    const next = chosen(search.text, asking, value)
    search.ask(next.text)
    caret = next.caret

    // The caret goes where the value ended, which is only true once Svelte has
    // put the new text in the field.
    queueMicrotask(() => {
      field?.focus()
      field?.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeydown(event: KeyboardEvent) {
    if (suggestions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        active = (active + 1) % suggestions.length
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        active = (active + suggestions.length - 1) % suggestions.length
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const value = suggestions[active]
        if (value !== undefined) {
          event.preventDefault()
          take(value)
          return
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // The popup and nothing else: the field keeps what is in it, and the
        // replace field below it keeps its place.
        shut = true
        return
      }
    }

    if (event.key === 'Escape' && search.replacing) {
      event.preventDefault()
      search.closeReplace()
    }
  }

  async function openHit(hit: Hit) {
    await workspace.open(hit.path)
    ongoto?.(hit.line)
  }
</script>

<div class="find">
  <div class="row">
    <div class="box">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={field}
        class="query"
        class:wide={search.asks}
        value={search.text}
        oninput={typing}
        onkeyup={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onclick={(event) => (caret = event.currentTarget.selectionStart ?? caret)}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
        onkeydown={onKeydown}
        placeholder={focused && !search.text
          ? t('path: tag: file: -word "…" /re/')
          : t('Search this space')}
        spellcheck="false"
        autofocus
      />

      <!-- How many lines answered, in the field it was asked in. -->
      {#if search.asks && search.hits.length}
        <span class="found" transition:fly={{ x: 6, duration: 130, easing: cubicOut }}>
          {search.hits.length}
        </span>
      {/if}

      <!-- The one place a bookmark is a mark rather than a word: there is no
           row to right-click, and a star in the box says what it does. -->
      {#if searchMark}
        {@const kept = workspace.bookmarks.has(searchMark)}
        <button
          class="star"
          class:on={kept}
          title={kept ? t('Remove bookmark') : t('Bookmark')}
          aria-label={kept ? t('Remove bookmark') : t('Bookmark')}
          aria-pressed={kept}
          onclick={() => workspace.bookmarks.toggle(searchMark)}
          transition:fly={{ x: 6, duration: 130, easing: cubicOut }}
        >
          <svg viewBox="0 0 13 13"><path d={STAR} /></svg>
        </button>
      {/if}

      {#if suggestions.length}
        <Suggest values={suggestions} typed={asking?.typed ?? ''} {active} onchoose={take} />
      {/if}
    </div>

    <button
      class="swap"
      class:active={search.replacing}
      title={t('Replace')}
      aria-label={t('Replace')}
      aria-pressed={search.replacing}
      onclick={() => search.toggleReplace()}
    >
      <svg viewBox="0 0 13 13"><path d={SWAP} /></svg>
    </button>
  </div>

  {#if search.replacing}
    <div class="row" transition:fly={{ y: -6, duration: 130, easing: cubicOut }}>
      <input
        class="query"
        value={search.replacement}
        oninput={(event) => (search.replacement = event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Escape') search.closeReplace()
          if (event.key === 'Enter') void search.replace()
        }}
        placeholder={t('Replace with')}
        spellcheck="false"
      />

      <button class="apply" disabled={!search.chosen.length} onclick={() => void search.replace()}>
        {t('Replace')}<span class="count">{search.chosen.length}</span>
      </button>
    </div>
  {/if}
</div>

{#if groups.length}
  <ul>
    {#each groups as group, index (`${group.path}:${index}`)}
      <li class="group">
        <div class="note">
          <!-- One character for "near enough", where a word would be prose. The
               place in the list already says it: the guesses are under the
               answers. -->
          {#if group.loose}<span class="guess" title={t('Close match')}>~</span>{/if}{stripped(
            group.name,
          )}
        </div>

        {#each group.hits as hit (hit.line)}
          <div class="line">
            {#if search.replacing}
              <button
                class="tick"
                class:on={search.keeps(hit)}
                role="checkbox"
                aria-checked={search.keeps(hit)}
                aria-label={hit.text}
                onclick={() => search.toggle(hit)}
              >
                <svg viewBox="0 0 13 13"><path d={TICK} /></svg>
              </button>
            {/if}

            <button class="hit" onclick={() => void openHit(hit)}>
              {#each pieces(hit.text, hit.ranges) as piece, at (at)}
                {#if piece.mark}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
              {/each}
            </button>
          </div>
        {/each}
      </li>
    {/each}
  </ul>
{:else if search.asks && !search.running}
  <p class="empty-text">{t('Nothing found')}</p>
{:else if !search.text.trim() && tags.length}
  <!-- An empty search offers the space's own tags, which is how you find out
       what there is to search for. As the tree their slashes describe, in the
       file tree's own rows: `work/nib/canvas` is a path like a folder's. -->
  <TagTree nodes={tags} />
{/if}

<style>
  .find {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  /* Holds the field and everything that sits inside or under it. */
  .box {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .query {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      padding-right var(--dur-fast) var(--ease-out);
  }

  /* Room for the count and the star, taken only once there is a search to
     count or to keep. */
  .query.wide {
    padding-right: 56px;
  }

  .query:focus {
    border-color: var(--accent);
  }

  .found {
    position: absolute;
    top: 50%;
    right: 32px;
    transform: translateY(-50%);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  /* Inside the field rather than beside it: it is about what is in the field. */
  .star {
    position: absolute;
    top: 50%;
    right: 5px;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .star:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .star:active {
    transform: translateY(-50%) scale(0.88);
  }

  .star.on {
    color: var(--accent);
  }

  /* Filled once it is kept: the shape alone says which way it stands. */
  .star.on svg {
    fill: currentColor;
  }

  .star:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  /* Beside the field, because it is about the field rather than in it. */
  .swap {
    flex: none;
    width: 28px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .swap:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .swap:active {
    background: var(--press);
  }

  .swap.active {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .swap:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .apply {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 5px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .apply:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .apply:active:not(:disabled) {
    background: var(--accent-press);
  }

  .apply:disabled {
    opacity: 0.45;
  }

  .apply .count {
    color: inherit;
    opacity: 0.75;
  }

  .apply:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* One note's lines, under the note's name. */
  .group + .group {
    margin-top: var(--space-2);
  }

  .note {
    padding: 0 8px 2px;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The mark on a note found only by a near enough match. Quieter than the name
     it sits in front of: it says which kind of answer this is, and it is not the
     answer. */
  .guess {
    margin-right: 3px;
    color: var(--muted);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .hit {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .hit:hover {
    background: var(--item-hover-bg-color);
  }

  .hit:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .hit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* The words that answered, marked in the line they were found on. */
  mark {
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--text-strong);
    font-weight: 550;
  }

  /* A square that fills when it is on, which is the whole of what it says. */
  .tick {
    flex: none;
    width: 17px;
    height: 17px;
    display: grid;
    place-items: center;
    margin-left: 4px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: none;
    color: transparent;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .tick:hover {
    border-color: var(--accent-line);
  }

  .tick:active {
    transform: scale(0.86);
  }

  .tick.on {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .tick:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .tick svg {
    width: 11px;
    height: 11px;
  }

  .empty-text {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The field a search is typed into, at the size the answers are read at.
     Anything from 16px up is also past where iOS zooms into a focused field. */
  :global([data-touch]) .query {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .query.wide {
    padding-right: 60px;
  }

  :global([data-touch]) .swap,
  :global([data-touch]) .apply {
    min-height: var(--touch-target);
  }

  :global([data-touch]) .swap {
    width: var(--touch-target);
  }

  /* Same size as the tree rows: everything in the drawer is something a thumb
     has to land on, and a line of a note is there to be read. */
  :global([data-touch]) .hit {
    min-height: var(--touch-row);
    display: flex;
    align-items: center;
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .note {
    padding: var(--space-2) var(--touch-pad) 2px;
    font-size: var(--text-base);
  }

  :global([data-touch]) .tick {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  :global([data-touch]) .tick svg {
    width: var(--touch-mark);
    height: var(--touch-mark);
  }

  :global([data-touch]) .empty-text {
    margin: var(--space-3) var(--space-2) 0;
    font-size: var(--touch-text);
  }
</style>
