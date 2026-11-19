<script lang="ts">
  import { Facts, prompt } from '../../../ui-kit/src/api'
  import { localDate, localNumber, spaceHolding } from '../../../platform/src/api'
  import { diskNear, diskShare, shares } from '@orden/online'
  import { runner } from '../../../sync-client/src/api'
  import { workspace } from '../../../workspace/src/api'
  import { summaryOf } from './choosing'
  import MachinePicker from './MachinePicker.svelte'
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

  const detail = (row: SessionRow) => [row.file, row.at === null ? null : when(row.at)].filter((one) => one !== null)

  async function open(path: string) {
    const space = spaceHolding(workspace.spaces, path)
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

  function bytes(value: number): string {
    const [amount, unit] = value >= 1e9 ? [value / 1e9, 'GB'] : [value / 1e6, 'MB']
    const shown = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount)
    return `${localNumber(shown)} ${unit}`
  }

  const about = $derived(known?.machine?.server ?? null)
  const summary = $derived(about ? summaryOf(about) : null)

  const allowed = $derived(known?.allowed === true)

  $effect(() => {
    if (allowed) void machine.offer()
  })

  const offers = $derived(machine.offers)

  const choosable = $derived(offers !== null && (!known?.machine || known.machine.host === 'hetzner'))

  const running = $derived((sessions.list ?? []).filter((one) => one.alive === true).length)

  const STATES: Record<string, string> = {
    awake: 'Awake',
    starting: 'Starting',
    stopping: 'Stopping',
  }
  const stateWords = $derived(STATES[state ?? ''] ?? 'Asleep')

  const hours = (seconds: number) =>
    localNumber(Math.round(seconds / (seconds < 36_000 ? 360 : 3600)) / (seconds < 36_000 ? 10 : 1))

  const share = $derived(known ? shares(known.used, known.limit) : null)

  const disk = $derived(known?.machine?.disk ?? null)

  const meter = (label: string, share: number, words: string, near = false) => ({
    label,
    share,
    near,
    words,
  })
  const time = (used: number, limit: number) => `${hours(used)} / ${hours(limit)} h`
  const room = (used: number, limit: number) => `${bytes(used)} / ${bytes(limit)}`

  const diskMeter = $derived(disk ? [meter('Disk', diskShare(disk), room(disk.used, disk.total), diskNear(disk))] : [])

  const meters = $derived.by(() => {
    if (server) return diskMeter
    if (!known || !share) return []
    const { used, limit } = known
    return [
      meter('Hours', share.awakeS, time(used.awakeS, limit.awakeS), machine.near),
      meter('CPU', share.cpuS, time(used.cpuS, limit.cpuS)),
      meter('Home', share.homeBytes, room(used.homeBytes, limit.homeBytes)),
      meter('Web', share.egressBytes, room(used.egressBytes, limit.egressBytes)),
      ...diskMeter,
    ]
  })

  const refusal = $derived(
    machine.known?.allowed === false ? refusalWords('list') : machine.refused ? refusalWords(machine.refused) : null,
  )
</script>

<div class="online">
  {#if known?.machine ?? choosable}
    <div class="card">
      <div class="orden-setting setting">
        <span class="name">
          Machine
          {#if summary}
            <small class="summary"><Facts parts={summary.about} /></small>
            {#if summary.cost.length}<small class="summary"><Facts parts={summary.cost} /></small>{/if}
          {/if}
        </span>
        <div class="row">
          <span class="hint">{stateWords}</span>
          {#if choosable}
            <button
              class="orden-chip"
              aria-expanded={machine.picking}
              disabled={state === 'starting' || state === 'stopping'}
              onclick={() => (machine.picking = !machine.picking)}>{about?.made ? 'Change' : 'Choose'}</button
            >
          {/if}
          <button
            class="orden-chip"
            disabled={machine.busy || state === 'stopping' || (server && state === 'starting')}
            onclick={() => void machine.startStop(!awake)}>{awake ? (server ? 'Restart' : 'Stop') : 'Start'}</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if machine.picking && offers}
    <div class="card">
      <MachinePicker {offers} server={about} {running} chosen={() => machine.chosen()} />
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
