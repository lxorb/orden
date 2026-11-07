<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { i18n, t } from '../../i18n.svelte'
  import { dur, slide } from '../../motion'
  import { afterQuiet } from '../../timing'
  import { workspace } from '../../workspace.svelte'
  import { ACTIVE_FOR } from './marks'
  import { asking } from './asking.svelte'
  import Question from './Question.svelte'
  import ReaderAsk from './ReaderAsk.svelte'
  import { aboutOf, hostOf } from './session'
  import Spark from './Spark.svelte'
  import AgentWatch from './AgentWatch.svelte'
  import { started } from './live.svelte'
  import { wordFor } from './words'

  const { agent }: { agent: string } = $props()

  const activity = started()

  const FIRST = 12
  const LOG_EVERY = 1000

  const name = $derived(activity.nameOf(agent))
  const colour = $derived(activity.colourOf(agent))
  const stopped = $derived(activity.stopped(agent))
  const questions = $derived(activity.questions.filter((one) => one.agent === agent))
  const asked = $derived(asking.of(agent))
  const tabs = $derived(Object.values(activity.seen.tabs).filter((one) => one.agent === agent))
  const calls = $derived(activity.callsOf(agent))
  const undoable = $derived(activity.undoable(agent) !== null)
  const front = $derived(workspace.active?.kind === 'note' ? workspace.active.shown : null)
  let all = $state(false)
  let watched = $state<string | null>(null)

  const doing = $derived.by(() => {
    const last = activity.seen.doing[agent]
    if (!last || activity.now - last.at >= ACTIVE_FOR) return null

    const word = wordFor(last.verb)
    if (word === null) return null

    const about = last.tab === null ? null : titleOf(last.tab)
    return about ? `${word} · ${about}` : word
  })

  const latest = $derived(activity.seen.doing[agent]?.at ?? 0)

  const readSoon = afterQuiet(
    () => void activity.readLog().catch(() => undefined),
    LOG_EVERY,
    LOG_EVERY,
  )
  $effect(() => {
    if (latest !== 0) readSoon()
  })

  onMount(() => {
    void activity.readLog().catch(() => undefined)
    return () => readSoon.cancel()
  })

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
      class="orden-glyph"
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

  {#if tabs.length}
    <ul class="tabs">
      {#each tabs as tab (tab.id)}
        <li>
          <button
            class="orden-row is-short"
            class:is-on={watched === tab.id}
            data-agent-tab={tab.id}
            onclick={() => (watched = tab.id)}
          >
            <span class="orden-row-label">{tab.title || hostOf(tab.url)}</span>
            <span class="orden-row-meta">{hostOf(tab.url)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if watched !== null}
    <AgentWatch {activity} tab={watched} onclose={() => (watched = null)} />
  {/if}

  {#if calls.length}
    <ol class="calls">
      {#each all ? calls : calls.slice(0, FIRST) as call (call.seq)}
        <li class="call" class:failed={call.status === 'error'}>
          <span class="word">{wordFor(call.verb)}</span>
          <span class="about">{aboutOf(call, titleOf) ?? ''}</span>
          <span class="orden-row-meta">{timeOf(call.at)}</span>
        </li>
      {/each}
    </ol>
    {#if !all && calls.length > FIRST}
      <button class="orden-row is-short more" onclick={() => (all = true)}>
        <span class="orden-row-label">{t('Show all')}</span>
      </button>
    {/if}
  {/if}

  <div class="acts">
    {#if calls.length}
      <button class="orden-chip" onclick={() => void activity.addToNote(agent)}>
        {front === null ? t('Save as a note') : t('Add to {name}', { name: front })}
      </button>
    {/if}
    {#if undoable}
      <button class="orden-chip" onclick={() => void activity.undo(agent)}>
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

  .orden-glyph svg path,
  .orden-glyph svg rect {
    fill: currentColor;
    stroke: none;
  }

  .tabs,
  .calls {
    margin: 0;
    padding: 0;
    list-style: none;
  }

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
