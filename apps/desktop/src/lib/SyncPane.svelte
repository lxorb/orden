<script lang="ts">
  import { account } from './account.svelte'
  import { api } from './api'
  import { amount, plural, t } from './i18n.svelte'
  import { when } from './when'
  import Facts from './Facts.svelte'
  import { log } from './log'
  import { KEEP_MONTH, KEEP_YEAR, modes, rollbackSteps } from './modes.svelte'
  import { dur, fade } from './motion'
  import Select from './Select.svelte'
  import { record } from './sync/record.svelte'
  import type { Answer, Clash } from './sync/conflicts'
  import { sync } from './sync.svelte'
  import { nameOf, rootedAt } from './space-paths'
  import { syncedCopies } from './foreign/synced'
  import { asking, type Engine } from './sync2/asking.svelte'
  import { scan } from './sync2/store'
  import { workspace } from './workspace.svelte'
  import Hint from './Hint.svelte'

  let days = $state(1)

  const back = $derived(rollbackSteps(modes.keepVersions))

  const chosen = $derived(back.includes(days) ? days : (back.at(-1) ?? 1))
  let asked = $state<{ notes: number; paths: string[]; more: boolean; at: number } | null>(null)
  let rolling = $state(false)
  let rolled = $state<number | null>(null)
  let wrong = $state<string | null>(null)

  interface Shown {
    at: number
    space: string
    pulled: number
    pushed: number
    clashed: number
    failed: string | null
  }

  const SHOWN = 20

  let logged = $state<Shown[]>([])

  $effect(() => {
    const engine = asking.engine
    if (!engine) return

    let live = true
    const read = () =>
      void logOf(engine)
        .then((rows) => {
          if (live) logged = rows
        })
        .catch((error: unknown) =>
          log('warn', `sync: the pass log would not read: ${String(error)}`),
        )
    read()
    const stop = engine.on('pass', read)
    return () => {
      live = false
      stop()
    }
  })

  async function logOf(engine: Engine): Promise<Shown[]> {
    const [rows, spaces] = await engine.store.read([scan('log'), scan('spaces')])
    const nameFor = (id: string | null) => {
      const root = spaces.find((one) => one.space_id === id)?.root
      if (root === undefined) return id ?? ''
      return rootedAt(workspace.spaces, root)?.name ?? nameOf(root)
    }

    return rows
      .slice(-SHOWN)
      .reverse()
      .map((row) => ({
        at: row.at,
        space: nameFor(row.space),
        pulled: row.pulled ?? 0,
        pushed: row.pushed ?? 0,
        clashed: 0,
        failed: row.failed,
      }))
  }

  const passes = $derived(asking.engine ? logged : record.passes.slice(0, SHOWN))

  const rules = [
    { value: 'both', label: t('Keep both copies') },
    { value: 'newest', label: t('Let the newest win') },
    { value: 'ask', label: t('Ask me each time') },
  ]

  const spaceId = $derived(
    workspace.activeSpace ? sync.remoteIdFor(workspace.activeSpace.root) : null,
  )

  function moment(): number {
    return Date.now() - chosen * 24 * 60 * 60 * 1000
  }

  async function look() {
    const token = account.accountToken
    if (!token || !spaceId) return

    wrong = null
    rolled = null

    try {
      const at = moment()
      const said = await api.rollback(token, spaceId, at, '', true)
      asked = {
        notes: said.notes + (said.left ?? 0),
        paths: said.paths ?? [],
        more: said.more === true,
        at,
      }
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    }
  }

  const ROUNDS = 100

  async function roll() {
    const token = account.accountToken
    if (!token || !spaceId || rolling) return

    rolling = true
    wrong = null
    rolled = 0

    try {
      const at = asked?.at ?? moment()
      let put = 0
      let left = 0
      for (let round = 0; round < ROUNDS; round++) {
        const done = await api.rollback(token, spaceId, at)
        put += done.notes
        rolled = put
        left = done.partial ? (done.left ?? 0) : 0

        if (!done.partial || done.notes === 0) break
      }

      asked = left > 0 ? { notes: left, paths: [], more: false, at } : null
      if (left > 0) wrong = t('That did not work.')
      sync.nudge()
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    } finally {
      rolling = false
    }
  }

  const copies = $derived(syncedCopies(asking.engine))
  let removing = $state(false)
  let copiesGone = $state(false)

  async function removeCopies() {
    removing = true
    try {
      await copies.remove()
      copiesGone = true
    } catch (error) {
      log('warn', `sync: conflict copies stayed on the account - ${String(error)}`)
    } finally {
      removing = false
    }
  }

  async function settle(clash: Clash, answer: Answer) {
    await record.settle(clash, answer)
    sync.nudge()
  }

  function shortPath(path: string): string {
    return path.split(/[\\/]/).slice(-2).join('/')
  }

  const horizons = [
    { value: String(KEEP_MONTH), label: t('A month') },
    { value: String(KEEP_YEAR), label: t('A year') },
  ]
</script>

{#if !asking.engine}
  <h3>{t('When the same note was written twice')}</h3>

  <div class="card">
    <div class="orden-setting setting">
      <span class="name"
        ><span class="orden-named"
          >{t('On two devices')}<Hint
            text={t('What happens when one note was changed on two devices before they synced.')}
          /></span
        ></span
      >
      <div class="orden-setting-value">
        <Select
          value={modes.conflicts}
          options={rules}
          onchange={(value: string) => modes.setConflicts(value)}
          label={t('On two devices')}
        />
      </div>
    </div>
  </div>

  <p class="hint">
    {t('Nothing is ever thrown away: what does not win is kept as a version.')}
  </p>
{/if}

<h3>{t('History on the account')}</h3>

<div class="card">
  <div class="orden-setting setting">
    <span class="name"
      ><span class="orden-named"
        >{t('Keep versions')}<Hint
          text={t('How far back the account keeps earlier versions of your notes.')}
        /></span
      ></span
    >
    <div class="orden-setting-value">
      <Select
        value={String(modes.keepVersions)}
        options={horizons}
        onchange={(value: string) => modes.setKeepVersions(Number(value))}
        label={t('Keep versions')}
      />
    </div>
  </div>
</div>

<p class="hint">
  {t(
    'Everything from the last day, then one an hour, one a day after a month, one a week after three.',
  )}
</p>

{#if asking.engine && asking.held.length}
  <h3>{t('Waiting for you')}</h3>

  <div class="card" transition:fade={{ duration: dur(130) }}>
    {#each asking.held as note (note.id)}
      <button class="orden-action held" onclick={() => void asking.revisit(note)}>
        <span class="name">{note.name}</span>
        <span class="hint">{when(note.theirs.at, 'short')}</span>
      </button>
    {/each}
  </div>
{:else if !asking.engine && record.clashes.length}
  <h3>{t('Waiting for you')}</h3>

  <div class="card" transition:fade={{ duration: dur(130) }}>
    {#each record.clashes as clash (clash.path)}
      <div class="clash">
        <span class="name">{shortPath(clash.path)}</span>
        <span class="hint">{when(clash.at, 'short')}</span>
        <div class="answers">
          <button class="orden-chip" onclick={() => void settle(clash, 'mine')}>
            {t('Keep mine')}
          </button>
          <button class="orden-chip" onclick={() => void settle(clash, 'theirs')}>
            {t('Take theirs')}
          </button>
          <button class="orden-chip" onclick={() => void settle(clash, 'both')}>
            {t('Keep both')}
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

{#if copies.count && !copiesGone}
  <h3 transition:fade={{ duration: dur(130) }}>{t('Conflict copies from other apps')}</h3>

  <div class="card" transition:fade={{ duration: dur(130) }}>
    <button class="orden-action held" disabled={removing} onclick={() => void removeCopies()}>
      <span class="name">{t('Remove from sync')}</span>
      <span class="hint">{amount(copies.count)}</span>
    </button>
  </div>
{/if}

<h3>{t('What synced')}</h3>

{#if !passes.length}
  <p class="hint">{t('Nothing here.')}</p>
{:else}
  <div class="card">
    {#each passes as pass, at (at)}
      <div class="pass" class:bad={!!pass.failed}>
        <span class="at">{when(pass.at, 'short')}</span>
        <span class="what">
          {#if pass.failed}
            {t(pass.failed)}
          {:else}
            <Facts
              parts={[
                pass.pulled ? t('{count} down', { count: pass.pulled }) : '',
                pass.pushed ? t('{count} up', { count: pass.pushed }) : '',
                pass.clashed ? t('{count} waiting', { count: pass.clashed }) : '',
              ]}
            />
          {/if}
        </span>
        <span class="where">{pass.space}</span>
      </div>
    {/each}
  </div>

  {#if !asking.engine}
    <div class="card">
      <button class="orden-action" onclick={() => record.clear()}>{t('Clear the list')}</button>
    </div>
  {/if}
{/if}

<h3>{t('Go back')}</h3>

<div class="card">
  <div class="orden-setting setting">
    <span class="name"
      ><span class="orden-named"
        >{t('This space, as it was')}<Hint
          text={t('How far back Go back takes this space; it says first what would change.')}
        /></span
      ></span
    >
    <div class="orden-setting-value">
      <Select
        value={String(chosen)}
        options={back.map((one) => ({
          value: String(one),
          label: plural(one, { one: '{count} day ago', other: '{count} days ago' }),
        }))}
        onchange={(value: string) => {
          days = Number(value)
          asked = null
        }}
        label={t('This space, as it was')}
      />
    </div>
  </div>
</div>

{#if asked}
  <p class="note" transition:fade={{ duration: dur(130) }}>
    {asked.notes
      ? plural(asked.notes, {
          one: '{count} note would go back to what it said then.',
          other: '{count} notes would go back to what they said then.',
        })
      : t('Nothing has changed since then.')}
  </p>
{/if}

{#if rolled !== null}
  <p class="note">
    {plural(rolled, { one: '{count} note went back.', other: '{count} notes went back.' })}
  </p>
{/if}

{#if wrong}
  <p class="hint bad">{wrong}</p>
{/if}

<div class="card">
  {#if asked?.notes}
    <button class="orden-action is-danger" disabled={rolling} onclick={() => void roll()}>
      {rolling ? t('Going back') : t('Go back')}
    </button>
  {:else}
    <button class="orden-action" disabled={!spaceId} onclick={() => void look()}>
      {t('What would change?')}
    </button>
  {/if}
</div>

<style>
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  h3:first-child,
  :global(h2) + h3 {
    margin-top: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .pass,
  :global(.sheet.phone) .clash {
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  .clash {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    width: 100%;
    padding: var(--space-2) 0;
  }

  .clash .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .answers {
    display: flex;
    gap: var(--space-2);
    width: 100%;
  }

  .held {
    gap: var(--space-3);
  }

  .held .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.sheet.phone) .held {
    padding: 0 var(--touch-pad);
  }

  .pass {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    width: 100%;
    min-height: 26px;
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }

  .pass .at {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .pass .what {
    flex: 1;
    min-width: 0;
  }

  .pass .where {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pass.bad .what {
    color: var(--danger);
  }
</style>
