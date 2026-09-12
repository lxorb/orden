<script lang="ts">
  /** What syncing is doing, and the two decisions it needs.
   *
   *  Three things, in the order somebody asks for them. What happens when the
   *  same note was written in two places, which is the one real choice; whatever
   *  is waiting for an answer, which is the only thing here that is urgent; and
   *  what the last few passes did, which is what somebody reads when syncing
   *  looks stuck.
   *
   *  And, at the foot, the one rescue: a space put back to how it read at a
   *  moment. It is last because it is the thing nobody wants and somebody
   *  occasionally needs, and it says what it would change before it changes
   *  anything. */

  import { fade } from 'svelte/transition'

  import { account } from './account.svelte'
  import { api } from './api'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { dur } from './motion'
  import Select from './Select.svelte'
  import { record } from './sync/record.svelte'
  import type { Answer, Clash } from './sync/conflicts'
  import { sync } from './sync.svelte'
  import { workspace } from './workspace.svelte'

  /** How far back the rollback offers to go, in days. A month is what the
   *  account keeps; see services/sync/versions.ts. */
  const DAYS = [1, 7, 30]

  let days = $state(1)
  let asked = $state<{ notes: number; paths: string[]; more: boolean } | null>(null)
  let rolling = $state(false)
  let rolled = $state<number | null>(null)
  let wrong = $state<string | null>(null)

  const rules = [
    { value: 'both', label: t('Keep both copies') },
    { value: 'newest', label: t('Let the newest win') },
    { value: 'ask', label: t('Ask me each time') },
  ]

  const spaceId = $derived(
    workspace.activeSpace ? sync.remoteIdFor(workspace.activeSpace.root) : null,
  )

  const when = (stamp: number) =>
    new Date(stamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

  function moment(): number {
    return Date.now() - days * 24 * 60 * 60 * 1000
  }

  async function look() {
    const token = account.accountToken
    if (!token || !spaceId) return

    wrong = null
    rolled = null

    try {
      const said = await api.rollback(token, spaceId, moment(), '', true)
      asked = { notes: said.notes, paths: said.paths ?? [], more: said.more === true }
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    }
  }

  async function roll() {
    const token = account.accountToken
    if (!token || !spaceId || rolling) return

    rolling = true
    wrong = null

    try {
      const done = await api.rollback(token, spaceId, moment())
      rolled = done.notes
      asked = null
      // The notes are on the account; this is what brings them down here.
      sync.nudge()
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    } finally {
      rolling = false
    }
  }

  async function settle(clash: Clash, answer: Answer) {
    await record.settle(clash, answer)
    sync.nudge()
  }

  function shortPath(path: string): string {
    return path.split(/[\\/]/).slice(-2).join('/')
  }
</script>

<h3>{t('When the same note was written twice')}</h3>

<div class="card">
  <div class="setting">
    <span class="name">{t('On two devices')}</span>
    <div class="pick">
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

{#if record.clashes.length}
  <h3>{t('Waiting for you')}</h3>

  <div class="card" transition:fade={{ duration: dur(130) }}>
    {#each record.clashes as clash (clash.path)}
      <div class="clash">
        <span class="name">{shortPath(clash.path)}</span>
        <span class="hint">{when(clash.at)}</span>
        <div class="answers">
          <button class="action" onclick={() => void settle(clash, 'mine')}>
            {t('Keep mine')}
          </button>
          <button class="action" onclick={() => void settle(clash, 'theirs')}>
            {t('Take theirs')}
          </button>
          <button class="action" onclick={() => void settle(clash, 'both')}>
            {t('Keep both')}
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<h3>{t('What synced')}</h3>

{#if !record.passes.length}
  <p class="hint">{t('Nothing yet. A pass that moves nothing is not written down.')}</p>
{:else}
  <div class="card">
    {#each record.passes.slice(0, 20) as pass (pass.at)}
      <div class="pass" class:bad={!!pass.failed}>
        <span class="at">{when(pass.at)}</span>
        <span class="what">
          {#if pass.failed}
            {pass.failed}
          {:else}
            {[
              pass.pulled ? t('{count} down', { count: pass.pulled }) : '',
              pass.pushed ? t('{count} up', { count: pass.pushed }) : '',
              pass.clashed ? t('{count} waiting', { count: pass.clashed }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          {/if}
        </span>
        <span class="where">{pass.space}</span>
      </div>
    {/each}
  </div>

  <button class="action" onclick={() => record.clear()}>{t('Clear the list')}</button>
{/if}

<h3>{t('Go back')}</h3>

<div class="card">
  <div class="setting">
    <span class="name">{t('This space, as it was')}</span>
    <div class="pick">
      <Select
        value={String(days)}
        options={DAYS.map((one) => ({
          value: String(one),
          label: one === 1 ? t('1 day ago') : t('{count} days ago', { count: one }),
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
      ? t('{count} notes would go back to what they said then.', { count: asked.notes })
      : t('Nothing has changed since then.')}
  </p>
{/if}

{#if rolled !== null}
  <p class="note">{t('{count} notes went back.', { count: rolled })}</p>
{/if}

{#if wrong}
  <p class="hint bad">{wrong}</p>
{/if}

<div class="card">
  {#if asked?.notes}
    <button class="action danger" disabled={rolling} onclick={() => void roll()}>
      {rolling ? t('Going back') : t('Go back')}
    </button>
  {:else}
    <button class="action" disabled={!spaceId} onclick={() => void look()}>
      {t('What would change?')}
    </button>
  {/if}
</div>

<p class="hint">
  {t('The account keeps a month of versions of every note that syncs.')}
</p>

<style>
  /* One waiting note: what it is, when it happened, and the three answers. The
     answers are a row of their own, because on a phone three verbs do not fit
     beside a file name. */
  .clash {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    width: 100%;
    padding: var(--space-2) 0;
  }

  .answers {
    display: flex;
    gap: var(--space-2);
    width: 100%;
  }

  /* One pass: when, what moved, and which space. The middle column takes the
     room, so a failure reads as a sentence rather than as a column. */
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
