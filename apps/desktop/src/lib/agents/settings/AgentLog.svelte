<script lang="ts">
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { i18n, plural, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { prompt } from '../../prompt.svelte'
  import { settings } from '../../settings.svelte'
  import { workspace } from '../../workspace.svelte'
  import { keepInNote } from '../ui/keep'
  import { aboutOf, sessionMarkdown } from '../ui/session'
  import { wordFor } from '../ui/words'
  import type { Grant } from '../verbs'
  import type { AgentsPane } from './pane.svelte'
  import { type Session, sessionsOf } from './sessions'

  const { pane, grant }: { pane: AgentsPane; grant: Grant } = $props()

  const FIRST = 3

  const sessions = $derived(sessionsOf(pane.calls, grant.id))
  let shown = $state(FIRST)
  let opened = $state<number | null>(null)

  const front = $derived(workspace.active?.kind === 'note' ? workspace.active.shown : null)

  const span = $derived(
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
  )
  const spanOf = (session: Session) => span.formatRange(session.start, session.end)
  const timeOf = (at: number) => i18n.when(at, { hour: '2-digit', minute: '2-digit' })

  async function earlier() {
    shown += FIRST
    while (sessions.length < shown && pane.earlier) await pane.readEarlier()
  }

  async function keep(session: Session) {
    await keepInNote(sessionMarkdown(grant.name, [...session.calls].reverse()))
    settings.open = false
  }

  async function clear() {
    const sure = await prompt.confirm({
      title: t('Clear what {name} did?', { name: grant.name }),
      confirmLabel: t('Clear'),
      danger: true,
    })
    if (sure) await pane.clearLog(grant.id)
  }
</script>

<div class="card">
  {#each sessions.slice(0, shown) as session (session.start)}
    {@const open = opened === session.start}
    <button
      class="orden-setting session"
      aria-expanded={open}
      onclick={() => (opened = open ? null : session.start)}
    >
      <span class="name">
        {spanOf(session)}
        <small>
          {plural(session.calls.length, { one: '{count} call', other: '{count} calls' })}
        </small>
      </span>
      <svg class="chevron orden-mirror" class:open viewBox="0 0 16 16" aria-hidden="true"
        ><path d="M6 3l5 5-5 5" /></svg
      >
    </button>

    {#if open}
      <div class="calls" transition:slide={{ duration: dur(180), easing: cubicOut }}>
        <ol>
          {#each session.calls as call, index (index)}
            <li class:failed={call.status === 'error'}>
              <span class="word">{wordFor(call.verb)}</span>
              <span class="about"><bdi>{aboutOf(call, () => null) ?? ''}</bdi></span>
              <span class="at">{timeOf(call.at)}</span>
            </li>
          {/each}
        </ol>
        <button class="orden-chip keep" onclick={() => void keep(session)}>
          {front === null ? t('Save as a note') : t('Add to {name}', { name: front })}
        </button>
      </div>
    {/if}
  {:else}
    <p class="hint">{t('Not used yet.')}</p>
  {/each}

  {#if sessions.length > shown || pane.earlier}
    <button class="orden-action" onclick={() => void earlier()}>{t('Show earlier')}</button>
  {/if}
  {#if sessions.length}
    <button class="orden-action is-danger" onclick={() => void clear()}>{t('Clear')}</button>
  {/if}
</div>

<style>
  .session .chevron {
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .session .chevron.open {
    transform: scaleX(var(--dir)) rotate(90deg);
  }

  .calls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-block: var(--space-1) var(--space-2);
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--row-height-sm);
  }

  .word {
    flex: none;
    color: var(--text);
  }

  .failed .word {
    color: var(--danger);
  }

  .about {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .at {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .keep {
    align-self: flex-start;
  }
</style>
