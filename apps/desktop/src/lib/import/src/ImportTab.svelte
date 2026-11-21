<script lang="ts">
  import { untrack } from 'svelte'
  import FolderOpen from 'lucide/dist/esm/icons/folder-open.mjs'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import Sparkle from 'lucide/dist/esm/icons/sparkle.mjs'
  import type { Tab } from '../../documents/src/api'
  import { Icon } from '../../glyphs/src/api'
  import { Mascot } from '../../mascot/src/api'
  import { CopyButton } from '../../ui-controls/src/api'
  import { brandIcon, readIcon } from '../../ui-kit/src/api'
  import { workspace } from '../../workspace/src/api'
  import { brandOf } from './brands'
  import type { RowKind } from './progress'
  import { kept, openAccess, readKept, removed, runs } from './run.svelte'

  const { tab }: { tab: Tab } = $props()
  const saved = untrack(() => readKept(tab.doc))
  const run = saved ? (runs.get(saved.id) ?? null) : null
  type Shown = RowKind | 'remaining'
  let shown = $state<Shown | null>(null)
  let asking = $state(false)
  const phase = $derived(run?.phase ?? 'interrupted')
  const working = $derived(phase === 'reading' || phase === 'writing' || phase === 'checking')
  const tally = $derived(run?.tally ?? { notes: 0, files: 0, skipped: 0, failed: 0 })
  const troubled = $derived(tally.failed + tally.skipped > 0)
  const spaceName = $derived(run?.space?.name ?? workspace.spaces.find((one) => one.id === saved?.space)?.name ?? '')
  const slug = $derived(brandOf(run?.format ?? null))
  const mood = $derived(
    phase === 'review'
      ? tally.failed
        ? 'unsure'
        : 'happy'
      : phase === 'failed'
        ? 'crying'
        : phase === 'interrupted' && !saved?.finished
          ? 'unsure'
          : null,
  )
  const percent = $derived(Math.round((run?.fraction ?? 0) * 100))
  $effect(() => {
    if (phase === 'review' && tally.failed && untrack(() => shown) === null) untrack(() => (shown = 'failed'))
  })
  const title = $derived(
    working
      ? `Importing “${spaceName}”`
      : phase === 'review'
        ? 'Ready to Import'
        : phase === 'failed'
          ? 'Import Failed'
          : saved?.finished
            ? 'Import Finished'
            : 'Import Interrupted',
  )
  const doing = $derived.by(() => {
    if (!run) return ''
    const at = run.current
    if (run.phase === 'reading') return at ? `Reading ${at}` : 'Reading…'
    if (run.phase === 'writing') return at ? `Importing ${at}` : 'Importing…'
    return at ? `Checking ${at}` : 'Checking…'
  })
  const counted = $derived(run?.total ? `${String(run.done)} of ${String(run.total)} files` : '')
  const said = $derived.by(() => {
    if (phase === 'review' && run) {
      const ok = tally.notes + tally.files
      return tally.failed
        ? {
            head: `${String(tally.failed)} ${tally.failed === 1 ? 'file' : 'files'} could not be imported`,
            text: `The other ${String(ok)} are in “${spaceName}”, checked against the source.`,
          }
        : { head: 'No problems', text: `All ${String(ok)} files are in “${spaceName}”, checked against the source.` }
    }
    if (phase === 'failed') return { head: 'Nothing could be imported', text: run?.error ?? '' }
    if (phase === 'interrupted')
      return saved?.finished ? null : { head: 'Orden closed before the import finished', text: '' }
    return null
  })
  const rows = $derived.by(() => {
    if (!run || shown === null) return []
    if (shown === 'remaining') return []
    return run.rows.filter((row) => row.kind === shown)
  })
  const EMPTY: Record<Shown, string> = {
    notes: 'No notes yet.',
    files: 'No other files yet.',
    remaining: 'Nothing left.',
    skipped: 'Nothing was skipped.',
    failed: 'Nothing failed.',
  }
  const COUNTS: { kind: Shown; label: string }[] = [
    { kind: 'notes', label: 'notes' },
    { kind: 'files', label: 'other files' },
    { kind: 'remaining', label: 'remaining' },
    { kind: 'skipped', label: 'skipped' },
    { kind: 'failed', label: 'failed' },
  ]
  const countOf = (kind: Shown) => (kind === 'remaining' ? (run?.remaining ?? 0) : tally[kind])
  const show = (kind: Shown) => (shown = shown === kind ? null : kind)
</script>

<div class="import orden-scrolls">
  <div class="column">
    <h1>{title}</h1>

    <div class="route" aria-hidden="true">
      <div class="end">
        <span class="tile"><Icon icon={slug ? readIcon(brandIcon(slug)) : null} fallback={FolderOpen} /></span>
        <span class="said" title={run?.bring.where ?? undefined}
          >{run?.bring.where?.split('/').pop() ?? saved?.label}</span
        >
      </div>
      <span class="arrow"><Icon icon={null} fallback={ArrowRight} /></span>
      <div class="end">
        <img class="own" src="/icon-256.png" alt="" draggable="false" />
        <span class="said">{spaceName}</span>
      </div>
    </div>

    {#if working && run}
      <div class="doing">{doing}</div>
      <div
        class="orden-meter"
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div class="orden-meter-fill" style:width="{percent}%"></div>
      </div>
      <div class="left"><span>{counted}</span><span>{run.left ?? ''}</span></div>
    {:else if said}
      {#if mood}<div class="face"><Mascot {mood} /></div>{/if}
      <h2>{said.head}</h2>
      {#if said.text}<p>{said.text}</p>{/if}
    {/if}

    {#if run && phase !== 'failed'}
      <div class="counts">
        {#each COUNTS as one (one.kind)}
          <button
            type="button"
            class:on={shown === one.kind}
            class:bad={one.kind === 'failed' && tally.failed > 0}
            aria-pressed={shown === one.kind}
            onclick={() => show(one.kind)}
          >
            <b>{countOf(one.kind)}</b><span>{one.label}</span>
          </button>
        {/each}
      </div>
      {#if shown}
        <div class="list">
          {#each rows as row, index (index)}
            <div class="row" class:failed={row.kind === 'failed'}>
              <span class="name">{row.path || row.why}</span>
              {#if row.path && row.why}<span class="why">{row.why}</span>{/if}
            </div>
          {:else}
            <div class="none">{EMPTY[shown]}</div>
          {/each}
        </div>
      {/if}
    {/if}

    {#if phase === 'review' && troubled}
      <button type="button" class="ask" aria-expanded={asking} onclick={() => (asking = !asking)}>
        <span class="spark"><Icon icon={null} fallback={Sparkle} /></span>No worries, daddy AI can fix this
      </button>
      {#if asking && run}
        <div class="prompt">
          <div class="prompt-head">
            <span>Prompt</span>
            <CopyButton value={run.prompt} />
          </div>
          <pre>{run.prompt}</pre>
        </div>
      {/if}
    {/if}

    <div class="actions">
      {#if working && run}
        <button type="button" class="orden-button is-quiet is-soft" onclick={() => void run.cancel()}>Cancel</button>
      {:else if phase === 'review' && run}
        <button type="button" class="orden-button is-quiet is-soft" onclick={() => void run.cancel()}
          >Cancel Import</button
        >
        <button type="button" class="orden-button" onclick={() => void run.complete()}>Complete Import</button>
      {:else if phase === 'failed' && run}
        {#if run.noAccess}
          <button type="button" class="orden-button is-quiet is-soft" onclick={() => void openAccess()}
            >Open Settings</button
          >
        {/if}
        <button type="button" class="orden-button is-quiet is-soft" onclick={() => void run.cancel()}>Close</button>
        <button type="button" class="orden-button" onclick={() => void run.again()}>Try Again</button>
      {:else}
        <button
          type="button"
          class="orden-button is-quiet is-soft"
          onclick={() => void removed(saved?.space ?? null, saved?.from ?? null)}
        >
          Cancel Import
        </button>
        <button type="button" class="orden-button" onclick={() => void kept(tab)}>
          {saved?.finished ? 'Complete Import' : 'Keep What Came In'}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .import {
    height: 100%;
    overflow: auto;
    display: flex;
    justify-content: center;
    font-family: var(--font-ui);
    color: var(--text);
  }
  .column {
    width: min(480px, 100% - 2 * var(--space-5));
    padding: var(--space-7) 0 var(--space-6);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .column > :global(*) {
    flex-shrink: 0;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }
  h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }
  p {
    margin: var(--space-1) 0 0;
    max-width: 400px;
    color: var(--muted);
    font-size: var(--text-row);
    line-height: 1.5;
  }
  .route {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: var(--space-6) 0;
  }
  .end {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 180px;
    min-width: 0;
  }
  .tile,
  .own {
    width: 56px;
    height: 56px;
    border-radius: 23%;
  }
  .tile {
    display: grid;
    place-items: center;
    padding: 14px;
    background: var(--surface-3);
    color: var(--text-strong);
  }
  .said {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .arrow {
    width: var(--icon-lg);
    height: var(--icon-lg);
    margin-top: 19px;
    color: var(--faint);
  }
  .arrow,
  .spark,
  .tile {
    stroke: currentColor;
    stroke-width: 2;
  }
  .doing,
  .left {
    align-self: stretch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .left {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .doing {
    margin-bottom: var(--space-2);
    font-size: var(--text-row);
  }
  [role='progressbar'] {
    align-self: stretch;
  }
  .left {
    margin-top: var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    min-height: 1.4em;
  }
  .face {
    margin: var(--space-2) 0 var(--space-3);
  }
  .counts {
    align-self: stretch;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }
  .counts button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: var(--space-2) 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    cursor: default;
  }
  @media (hover: hover) {
    .counts button:hover {
      background: var(--surface-2);
    }
  }
  .counts button.on {
    background: var(--surface-3);
  }
  .counts b {
    font-size: 20px;
    font-weight: 500;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
  }
  .counts .bad,
  .counts .bad b {
    color: var(--danger);
  }
  .list {
    align-self: stretch;
    max-height: 240px;
    overflow: auto;
    margin-top: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--card-radius);
    text-align: left;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px var(--space-3);
    border-bottom: 1px solid var(--line);
    font-size: var(--text-sm);
  }
  .row:last-child {
    border-bottom: none;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .why {
    color: var(--muted);
  }
  .failed .why {
    color: var(--danger);
  }
  .none {
    padding: var(--space-5);
    text-align: center;
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .ask {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--accent-line);
    border-radius: 99px;
    background: var(--accent-soft);
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-row);
    cursor: default;
  }
  .spark {
    width: var(--icon-sm);
    height: var(--icon-sm);
    color: var(--accent);
  }
  .prompt {
    align-self: stretch;
    margin-top: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--card-radius);
    text-align: left;
    overflow: hidden;
  }
  .prompt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  pre {
    margin: 0;
    padding: var(--space-3);
    max-height: 220px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
</style>
