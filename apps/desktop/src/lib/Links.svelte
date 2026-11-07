<script lang="ts">
  import { type NoteGraph, without } from './graph'
  import { neighbourhood } from './graph-walk'
  import { account } from './account.svelte'
  import { graphSurface, held } from './surfaces.svelte'
  import { t } from './i18n.svelte'
  import { links, type Outgoing, type Reference } from './link-index.svelte'
  import { insideSpace } from './space-paths'
  import { workspace } from './workspace.svelte'
  import { howFor, type OpenHow, tabAsk } from './new-tab'
  import HitList from './HitList.svelte'

  const {
    ongoto,
    graph = false,
    depth = 1,
    onlist,
  }: {
    ongoto?: ((line: number) => void) | undefined
    graph?: boolean
    depth?: number
    onlist?: (() => void) | undefined
  } = $props()

  const NOTHING: NoteGraph = { nodes: [], edges: [] }

  const path = $derived(workspace.panelTab?.path ?? null)
  const root = $derived(workspace.activeSpace?.root ?? null)

  const backlinks = $derived.by(() => (path ? links.backlinks(path) : []))

  const chatLinks = held(() =>
    __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./chats/view/ChatLinks.svelte'),
  )
  const outgoing = $derived.by(() => (path ? links.outgoing(path) : []))

  const attachments = $derived(workspace.graphSettings.here.attachments)

  const around = $derived.by(() => {
    const centre = workspace.panelNote
    if (centre === null) return NOTHING

    const left = workspace.leftOut.filter((one) => centre !== one && !centre.startsWith(`${one}/`))
    return neighbourhood(without(links.pictureOf(attachments), left), centre, depth)
  })

  const follows = (_value: unknown) => undefined

  let mentions = $state<Reference[]>([])

  $effect(() => {
    const note = path
    const space = root
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

  async function openAt(reference: Reference, press: MouseEvent) {
    if (!root) return
    const ask = tabAsk(press)
    await workspace.open(insideSpace(root, reference.path), howFor(ask))
    if (ask !== 'behind') ongoto?.(reference.line)
  }

  async function openTarget(link: Reference | Outgoing, press: MouseEvent) {
    if (!('to' in link) || !root) return
    if (link.to) await workspace.openEntry(insideSpace(root, link.to), howFor(tabAsk(press)))
    else if (tabAsk(press) === 'plain') {
      const tab = workspace.panelTab
      if (tab && tab.id !== workspace.activeTabId) workspace.activate(tab.id)
      ongoto?.(link.line)
    }
  }
</script>

{#if !path}
  <p class="empty-text">{t('No note is open')}</p>
{:else if graph}
  {#await graphSurface() then Graph}
    <Graph
      graph={around}
      current={workspace.panelNote}
      onopen={(target: string, how: OpenHow) => workspace.openRelative(target, how)}
      onescape={() => onlist?.()}
    />
  {/await}
{:else}
  {@render heading(t('Backlinks'), backlinks.length)}
  {#if backlinks.length}
    {@render hits(backlinks)}
  {:else}
    <p class="empty-text">{t('Nothing links here yet')}</p>
  {/if}

  {@render heading(t('Links out'), outgoing.length)}
  {#if outgoing.length}
    <HitList rows={outgoing} onpick={openTarget} />
  {:else}
    <p class="empty-text">{t('This note links nowhere yet')}</p>
  {/if}

  {#if mentions.length}
    {@render heading(t('Mentions'), mentions.length)}
    {@render hits(mentions)}
  {/if}

  {#if account.accountToken && !__EVEN_PLUGIN__}
    {#await chatLinks() then ChatLinks}
      <ChatLinks {path} />
    {/await}
  {/if}

  {#if links.scanning}
    <p class="empty-text">{t('Reading the space…')}</p>
  {/if}
{/if}

{#snippet heading(word: string, count: number)}
  <p class="orden-section">{word}<span>{count}</span></p>
{/snippet}

{#snippet hits(rows: readonly Reference[])}
  <HitList {rows} onpick={openAt} />
{/snippet}

<style>
  .empty-text {
    margin: var(--space-1) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  :global([data-touch]) .empty-text {
    font-size: var(--text-base);
  }
</style>
