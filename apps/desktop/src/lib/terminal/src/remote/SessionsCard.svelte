<script lang="ts">
  import { Facts, prompt } from '../../../ui-kit/src/api'
  import { localDate } from '../../../platform/src/api'
  import { held, type HeldRow } from './held.svelte'
  import { remote } from './hosts.svelte'

  $effect(() => {
    void held.refresh()
  })

  const when = (stamp: number) =>
    stamp > 0 ? localDate(stamp, { dateStyle: 'short', timeStyle: 'short' }) : null

  const machine = (row: HeldRow) =>
    row.host === null ? 'This computer' : (remote.byId(row.host)?.name ?? row.host)

  const named = (row: HeldRow) => row.name ?? row.program ?? machine(row)

  const state = (row: HeldRow) =>
    row.ended ? 'Ended' : row.open ? 'Open here' : row.watched ? 'Open elsewhere' : 'Detached'

  const facts = (row: HeldRow) => [
    machine(row),
    row.name !== null ? row.program : null,
    row.folder,
    state(row),
    when(row.last),
  ]

  async function rename(row: HeldRow) {
    const typed = await prompt.ask({ title: 'Rename', value: named(row), confirmLabel: 'Rename' })
    if (typed !== null) await held.rename(row, typed)
  }

  const idle = $derived(held.idle().length)

  const sure = (title: string, them: string) =>
    prompt.confirm({
      title,
      detail: `What runs in ${them} stops.`,
      confirmLabel: 'End',
      danger: true,
    })

  async function endIdle() {
    const title = idle === 1 ? 'End the idle session?' : `End ${idle} idle sessions?`
    if (await sure(title, 'them')) await held.endIdle()
  }

  async function end(row: HeldRow) {
    if (await sure(`End ${named(row)}?`, 'it')) await held.end(row)
  }
</script>

{#if held.list.length}
  <h3>Sessions</h3>
  <div class="card">
    {#each held.list as row (row.key)}
      <div class="orden-setting session">
        <span class="name">
          {named(row)}
          <small><Facts parts={facts(row)} /></small>
        </span>
        <div class="chips">
          {#if !row.ended}
            <button class="orden-chip" onclick={() => held.open(row)}>Open</button>
            <button class="orden-chip" onclick={() => void rename(row)}>Rename</button>
          {/if}
          <button class="orden-chip" onclick={() => void end(row)}>End</button>
        </div>
      </div>
    {/each}
  </div>
  {#if idle}
    <div class="idle">
      <p class="hint">
        {idle === 1 ? 'A session has' : `${idle} sessions have`} been idle for a week or more.
      </p>
      <button class="orden-chip" onclick={() => void endIdle()}>End idle</button>
    </div>
  {/if}
{/if}

{#if held.tmux.length}
  <h3>tmux on this computer</h3>
  <div class="card">
    {#each held.tmux as row (row.name)}
      <div class="orden-setting session">
        <span class="name">
          {row.name}
          <small
            ><Facts
              parts={[row.program, row.folder, row.attached ? 'Attached' : null, when(row.last)]}
            /></small
          >
        </span>
        <div class="chips">
          <button class="orden-chip" onclick={() => held.adopt(row)}>Open</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .session {
    gap: var(--space-3);
  }

  .idle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
