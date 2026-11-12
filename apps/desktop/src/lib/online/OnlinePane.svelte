<script lang="ts">
  import Facts from '../Facts.svelte'
  import { region } from '../region'
  import { localDate, localNumber } from '../region'
  import { diskNear, diskShare, shares } from '@orden/online'
  import { prompt } from '../prompt.svelte'
  import { within } from '../space-paths'
  import { runner } from '../sync-client/src/api'
  import { workspace } from '../workspace.svelte'
  import { cityOf } from './calls'
  import { opens, rowsOf, type SessionRow } from './listing'
  import { machine } from './machine.svelte'
  import { sessions } from './sessions.svelte'
  import { refusalWords } from './words'

  $effect(() => {
    void machine.refresh()
  })

  $effect(() => {
    void sessions.refresh()
    return sessions.watch()
  })

  const rows = $derived(rowsOf(sessions.list ?? []))

  const files = $derived(
    new Map(
      (sessions.list ?? []).map((one) => [
        one.session,
        one.term !== null && opens(one) ? runner.fileOf(one.term) : null,
      ]),
    ),
  )

  const when = (stamp: number) => localDate(stamp, { dateStyle: 'short', timeStyle: 'short' })

  const detail = (row: SessionRow) =>
    [row.file, row.at === null ? null : when(row.at)].filter((one) => one !== null)

  async function open(path: string) {
    const space = workspace.spaces.find((one) => within(one.root, path) !== null)
    if (space && space.id !== workspace.activeSpaceId) await workspace.showSpace(space.id)
    await workspace.openEntry(path, { activate: true })
  }

  async function end(row: SessionRow) {
    const sure = await prompt.confirm({
      title: `End ${row.name ?? 'Terminal'}?`,
      confirmLabel: 'End',
      danger: true,
    })
    if (sure) await sessions.end(row.listed)
  }

  const known = $derived(machine.known)
  const state = $derived(known?.machine?.state ?? null)
  const awake = $derived(state === 'awake' || state === 'starting')
  const server = $derived(known?.machine?.host === 'hetzner')

  const gb = (value: number) => `${localNumber(Math.round(value))} GB`

  function bytes(value: number): string {
    const [amount, unit] = value >= 1e9 ? [value / 1e9, 'GB'] : [value / 1e6, 'MB']
    const shown = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount)
    return `${localNumber(shown)} ${unit}`
  }

  const spec = $derived.by(() => {
    const about = known?.machine?.server
    if (!about) return null
    const parts = [
      about.type.toUpperCase(),
      ...(about.location ? [cityOf(about.location)] : []),
      `${localNumber(about.cores)} vCPU`,
      gb(about.memoryGb),
      gb(about.diskGb),
    ]
    if (about.price !== null && about.currency) {
      const price = new Intl.NumberFormat(region(), {
        style: 'currency',
        currency: about.currency,
      }).format(about.price)
      parts.push(`${price} a month`)
    }
    return parts.map((part) => part.replaceAll(' ', '\u00a0'))
  })

  const stateWords = $derived(
    state === 'awake'
      ? 'Awake'
      : state === 'starting'
        ? 'Starting'
        : state === 'stopping'
          ? 'Stopping'
          : 'Asleep',
  )

  const hours = (seconds: number) =>
    localNumber(Math.round(seconds / (seconds < 36_000 ? 360 : 3600)) / (seconds < 36_000 ? 10 : 1))

  const share = $derived(known ? shares(known.used, known.limit) : null)

  const disk = $derived(known?.machine?.disk ?? null)

  const diskMeter = $derived(
    disk
      ? [
          {
            label: 'Disk',
            share: diskShare(disk),
            near: diskNear(disk),
            words: `${bytes(disk.used)} / ${bytes(disk.total)}`,
          },
        ]
      : [],
  )

  const meters = $derived(
    server
      ? diskMeter
      : known && share
        ? [
            {
              label: 'Hours',
              share: share.awakeS,
              near: machine.near,
              words: `${hours(known.used.awakeS)} / ${hours(known.limit.awakeS)} h`,
            },
            {
              label: 'CPU',
              share: share.cpuS,
              near: false,
              words: `${hours(known.used.cpuS)} / ${hours(known.limit.cpuS)} h`,
            },
            {
              label: 'Home',
              share: share.homeBytes,
              near: false,
              words: `${bytes(known.used.homeBytes)} / ${bytes(known.limit.homeBytes)}`,
            },
            {
              label: 'Web',
              share: share.egressBytes,
              near: false,
              words: `${bytes(known.used.egressBytes)} / ${bytes(known.limit.egressBytes)}`,
            },
            ...diskMeter,
          ]
        : [],
  )

  const refusal = $derived(
    machine.known?.allowed === false
      ? refusalWords('list')
      : machine.refused
        ? refusalWords(machine.refused)
        : null,
  )
</script>

<div class="online">
  {#if known?.machine}
    <div class="card">
      <div class="orden-setting setting">
        <span class="name">
          Machine
          {#if spec}<small><Facts parts={spec} /></small>{/if}
        </span>
        <div class="row">
          <span class="hint">{stateWords}</span>
          <button
            class="orden-chip"
            disabled={machine.busy || state === 'stopping' || (server && state === 'starting')}
            onclick={() => void machine.startStop(!awake)}
            >{awake ? (server ? 'Restart' : 'Stop') : 'Start'}</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if rows.length}
    <div class="card">
      {#each rows as row (row.key)}
        {@const file = files.get(row.key) ?? null}
        <div class="orden-setting setting">
          <span class="name">
            {row.name ?? 'Terminal'}
            {#if detail(row).length}<small><Facts parts={detail(row)} /></small>{/if}
          </span>
          <div class="row">
            {#if file}
              <button class="orden-chip" onclick={() => void open(file)}>Open</button>
            {/if}
            <button class="orden-chip" onclick={() => void end(row)}>End</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if meters.length}
    <div class="card">
      <div class="stack">
        {#each meters as meter (meter.label)}
          <div class="meter">
            <div class="line">
              <span>{meter.label}</span>
              <span class="words">{meter.words}</span>
            </div>
            <div
              class="orden-meter"
              class:is-near={meter.near}
              role="meter"
              aria-label={meter.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(meter.share * 100)}
            >
              <div class="orden-meter-fill" style:width={`${meter.share * 100}%`}></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
    {#if known && !server}
      <p class="hint caption">
        Starts again {localDate(known.resets, { dateStyle: 'medium' })}
      </p>
    {/if}
  {/if}

  {#if refusal}
    <p class="hint">{refusal}</p>
  {/if}
</div>

<style>
  .online {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .setting .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
  }

  .meter {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .line {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .words {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.caption {
    margin-top: calc(-1 * var(--space-2));
  }

  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .setting {
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .setting .name small,
  :global(.sheet.phone) .hint {
    font-size: var(--text-base);
  }

  :global(.sheet.phone) .stack {
    padding: var(--touch-pad);
  }

  :global(.sheet.phone) .meter {
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .hint.caption {
    margin: calc(-1 * var(--space-2)) var(--touch-pad) 0;
  }
</style>
