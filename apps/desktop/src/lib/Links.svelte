<script lang="ts">
  /** What points at this note, what it points at, and where its name is written
   *  without a link - as three lists, or as a picture.
   *
   *  Three lists in one column, each headed by one word and a count. The rows are
   *  the search panel's rows, because they say the same thing: which note, and the
   *  line it says it on. Nothing is computed until the panel is open - the two
   *  derived lists are lazy, and the mentions are only looked for while it shows.
   *
   *  The picture is the same thing said the other way round: the note in the
   *  middle, what it is linked to around it, and nothing else. It comes from the
   *  same index the lists do, so the two cannot disagree about the space. */

  import Graph from './Graph.svelte'
  import { neighbourhood, type NoteGraph } from './graph'
  import { t } from './i18n.svelte'
  import { links, type Outgoing, type Reference } from './link-index.svelte'
  import { insideSpace } from './space-paths'
  import { workspace } from './workspace.svelte'

  const {
    ongoto,
    graph = false,
    depth = 1,
    onlist,
  }: {
    ongoto?: ((line: number) => void) | undefined
    /** Whether the panel is showing the picture rather than the lists. Held by
     *  the sidebar, whose tab row the switch between them sits in. */
    graph?: boolean
    /** How many links out from the open note the picture reaches. */
    depth?: number
    onlist?: (() => void) | undefined
  } = $props()

  /** A graph with nothing in it, as one object rather than a fresh one each
   *  reading: the view lays a graph out again whenever it is handed another. */
  const NOTHING: NoteGraph = { nodes: [], edges: [] }

  const path = $derived(workspace.active?.path ?? null)
  const root = $derived(workspace.activeSpace?.root ?? null)

  const backlinks = $derived.by(() => (path ? links.backlinks(path) : []))
  const outgoing = $derived.by(() => (path ? links.outgoing(path) : []))

  /** The open note and everything within `depth` links of it. Lazy like the lists
   *  above, so the space is only walked while the picture is the thing showing. */
  const around = $derived.by(() => {
    const centre = workspace.relativeNote
    return centre === null ? NOTHING : neighbourhood(links.graph, centre, depth)
  })

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  let mentions = $state<Reference[]>([])

  // Looked for while the panel is open, and again whenever the note or the index
  // changes. A search of the space is a round trip, so it is never on the way to
  // showing the two lists above it.
  $effect(() => {
    const note = path
    const space = root
    // Read for its own sake, so this runs again when a note is saved anywhere
    // in the space and a mention may have become a link.
    follows(links.version)

    if (!note || !space) {
      mentions = []
      return
    }

    let current = true
    void links.unlinked(note, space).then((found) => {
      if (current) mentions = found
    })

    return () => {
      current = false
    }
  })

  async function openAt(reference: Reference) {
    if (!root) return
    await workspace.open(insideSpace(root, reference.path))
    ongoto?.(reference.line)
  }

  async function openTarget(link: Outgoing) {
    if (!root || !link.to) return
    await workspace.openEntry(insideSpace(root, link.to))
  }
</script>

{#if !path}
  <p class="empty-text">{t('No note is open')}</p>
{:else if graph}
  <Graph
    graph={around}
    current={workspace.relativeNote}
    onopen={(target: string, keep: boolean) => workspace.openRelative(target, keep)}
    onescape={() => onlist?.()}
  />
{:else}
  <!-- Backlinks first: what points here is what the panel is opened for. -->
  <p class="nib-section">{t('Backlinks')}<span>{backlinks.length}</span></p>
  {#if backlinks.length}
    <ul>
      {#each backlinks as reference, index (`${reference.path}:${reference.line}:${index}`)}
        <li>
          <button class="nib-row hit" onclick={() => openAt(reference)}>
            <span class="hit-note">{reference.name}</span>
            <span class="hit-line">{reference.text}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-text">{t('Nothing links here yet')}</p>
  {/if}

  <p class="nib-section">{t('Links out')}<span>{outgoing.length}</span></p>
  {#if outgoing.length}
    <ul>
      {#each outgoing as link, index (`${link.target}:${link.line}:${index}`)}
        <li>
          <button
            class="nib-row hit"
            class:missing={!link.to}
            onclick={() => (link.to ? openTarget(link) : ongoto?.(link.line))}
          >
            <span class="hit-note">{link.name}</span>
            <span class="hit-line">{link.text}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-text">{t('This note links nowhere yet')}</p>
  {/if}

  {#if mentions.length}
    <p class="nib-section">{t('Mentions')}<span>{mentions.length}</span></p>
    <ul>
      {#each mentions as reference, index (`${reference.path}:${reference.line}:${index}`)}
        <li>
          <button class="nib-row hit" onclick={() => openAt(reference)}>
            <span class="hit-note">{reference.name}</span>
            <span class="hit-line">{reference.text}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if links.scanning}
    <p class="empty-text">{t('Reading the space…')}</p>
  {/if}
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Two lines rather than one, so the row is `.nib-row` stood on its end: the
     line the link is on, and the note it is in under it. */
  .hit {
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 1px;
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }

  .hit-note {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--accent);
  }

  /* A link with nowhere to go wears the same muted, dotted mark the link in the
     text does, so the two read as the same fact. */
  .missing .hit-note {
    color: var(--muted);
    text-decoration: underline dotted;
    text-underline-offset: 0.16em;
  }

  .hit-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-text {
    margin: var(--space-1) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  :global([data-touch]) .hit-note,
  :global([data-touch]) .empty-text {
    font-size: var(--text-base);
  }
</style>
