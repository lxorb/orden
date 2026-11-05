<script lang="ts">
  /** An outside agent's session, in the Ask panel where a conversation would be (#1120,
   *  docs/agent-native.md 9.5): who it is and what it is doing now, the questions it is
   *  waiting on, its own tabs, and the session as a list of what it did, with the three
   *  things to do about it - Stop, Add to note, Undo.
   *
   *  The log costs a read, so it is read when the session opens and again while the
   *  agent is at work - after the last of a burst of calls, at most once a second -
   *  rather than on a clock.
   *
   *  No headings: the mark and the name say whose it is, and the list reads as a list of
   *  what happened because every row is a time, a word and a name. */
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { i18n, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { workspace } from '../../workspace.svelte'
  import { ACTIVE_FOR } from './marks'
  import { asking } from './asking.svelte'
  import Question from './Question.svelte'
  import ReaderAsk from './ReaderAsk.svelte'
  import { aboutOf, hostOf } from './session'
  import Spark from './Spark.svelte'
  import { started } from './live.svelte'
  import { wordFor } from './words'

  const { agent }: { agent: string } = $props()

  const activity = started()

  /** How many calls of the session are drawn until the reader asks for the rest. */
  const FIRST = 12
  /** How often the log is read again at most, while calls keep coming. */
  const LOG_EVERY = 1000

  const name = $derived(activity.nameOf(agent))
  const colour = $derived(activity.colourOf(agent))
  const stopped = $derived(activity.stopped(agent))
  const questions = $derived(activity.questions.filter((one) => one.agent === agent))
  /** What it asked the reader with `ask_reader`, still waiting (#1078). */
  const asked = $derived(asking.of(agent))
  const tabs = $derived(Object.values(activity.seen.tabs).filter((one) => one.agent === agent))
  const calls = $derived(activity.callsOf(agent))
  const undoable = $derived(activity.undoable(agent) !== null)
  /** The note in front, by its name, which is where Add to puts the session. */
  const front = $derived(workspace.active?.kind === 'note' ? workspace.active.shown : null)
  let all = $state(false)

  /** What it is doing now: its last call in a word, and what the call was about. Only
   *  while it is at it; an agent that has gone quiet is just its name. */
  const doing = $derived.by(() => {
    const last = activity.seen.doing[agent]
    if (!last || activity.now - last.at >= ACTIVE_FOR) return null

    const word = wordFor(last.verb)
    if (word === null) return null

    const about = last.tab === null ? null : titleOf(last.tab)
    return about ? `${word} · ${about}` : word
  })

  /** When this agent's last call was, which is when the log has a line more. */
  const latest = $derived(activity.seen.doing[agent]?.at ?? 0)

  let reading: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    if (latest === 0) return
    clearTimeout(reading)
    reading = setTimeout(() => void activity.readLog().catch(() => undefined), LOG_EVERY)
  })

  onMount(() => {
    void activity.readLog().catch(() => undefined)
    return () => clearTimeout(reading)
  })

  /** A tab's name, whichever kind: an agent's own, or one of the reader's. */
  function titleOf(tab: string): string | null {
    const own = activity.seen.tabs[tab]
    if (own) return own.title || own.url
    return workspace.tabs.find((one) => one.id === tab)?.shown ?? null
  }

  function timeOf(at: number): string {
    return i18n.when(at, { hour: '2-digit', minute: '2-digit' })
  }
</script>

<section class="agent" aria-label={name}>
  <header class="head">
    <Spark {colour} turning={doing !== null} paused={stopped} />
    <div class="who">
      <span class="name">{name}</span>
      {#if doing}
        <span class="doing" transition:slide={{ duration: dur(140), easing: cubicOut }}>
          {doing}
        </span>
      {/if}
    </div>
    <button
      class="nib-glyph"
      title={stopped ? t('Continue') : t('Stop')}
      aria-label={stopped ? t('Continue') : t('Stop')}
      onclick={() => void (stopped ? activity.resume(agent) : activity.stop(agent))}
    >
      {#if stopped}
        <svg viewBox="0 0 13 13"><path d="M4.2 2.8v7.4l6-3.7z" /></svg>
      {:else}
        <svg viewBox="0 0 13 13"><rect x="3.2" y="3.2" width="6.6" height="6.6" rx="1.2" /></svg>
      {/if}
    </button>
  </header>

  {#each questions as approval (approval.id)}
    <Question {activity} {approval} />
  {/each}

  {#each asked as question (question.id)}
    <ReaderAsk {question} />
  {/each}

  <!-- Its own pages, by name: a press makes one a tab of the reader's, beside the one in
       front, without loading it again (6.7). -->
  {#if tabs.length}
    <ul class="tabs">
      {#each tabs as tab (tab.id)}
        <li>
          <button
            class="nib-row is-short"
            disabled={!activity.holds || tab.parked}
            onclick={() => void activity.show(tab.id)}
          >
            <span class="nib-row-label">{tab.title || hostOf(tab.url)}</span>
            <span class="nib-row-meta">{hostOf(tab.url)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if calls.length}
    <ol class="calls">
      {#each all ? calls : calls.slice(0, FIRST) as call (call.seq)}
        <li class="call" class:failed={call.status === 'error'}>
          <span class="word">{wordFor(call.verb)}</span>
          <span class="about">{aboutOf(call, titleOf) ?? ''}</span>
          <span class="nib-row-meta">{timeOf(call.at)}</span>
        </li>
      {/each}
    </ol>
    {#if !all && calls.length > FIRST}
      <button class="nib-row is-short more" onclick={() => (all = true)}>
        <span class="nib-row-label">{t('Show all')}</span>
      </button>
    {/if}
  {/if}

  <div class="acts">
    {#if calls.length}
      <button class="nib-chip" onclick={() => void activity.addToNote(agent)}>
        {front === null ? t('Save as a note') : t('Add to {name}', { name: front })}
      </button>
    {/if}
    {#if undoable}
      <button class="nib-chip" onclick={() => void activity.undo(agent)}>
        {t('Undo edits by {name}', { name })}
      </button>
    {/if}
  </div>
</section>

<style>
  .agent {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1) var(--space-3);
    font-family: var(--font-ui);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding-inline-start: var(--row-pad);
  }

  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    color: var(--text-strong);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .doing {
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nib-glyph svg path,
  .nib-glyph svg rect {
    fill: currentColor;
    stroke: none;
  }

  .tabs,
  .calls {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* A row of the log: the word, what it was about, and when, at the far end where the
     times make a column. */
  .call {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
    padding: 0 var(--row-pad);
    color: var(--muted-strong);
    font-size: var(--text-sm);
    line-height: var(--row-height-sm);
  }

  .word {
    flex: none;
    color: var(--text);
  }

  .about {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .failed .word {
    color: var(--danger);
  }

  .more {
    color: var(--muted);
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 var(--row-pad);
  }

  .acts:empty {
    display: none;
  }
</style>
