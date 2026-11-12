<script lang="ts">
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import Thinking from '../Thinking.svelte'
  import { copyText } from '../../clipboard'
  import { dur, fade, fly } from '../../motion'
  import type { Place } from '../../row-window'
  import { scrollbar } from '../../scrollbar'
  import { settings } from '../../settings.svelte'
  import type { ThreadHead } from '../chat/types'
  import { beside, ordered, stateOf } from '../session-state'
  import { chat } from './chat.svelte'
  import ChatRow from './ChatRow.svelte'
  import ChatWindow from './ChatWindow.svelte'
  import { sourcesFor } from './citations'
  import { hostHere } from './host'
  import { slides } from './slide'
  import Branches from '../review/Branches.svelte'
  import ChangesCard from '../review/ChangesCard.svelte'
  import Reply from './Reply.svelte'

  const { ongoto, ready }: { ongoto?: ((line: number) => void) | undefined; ready: boolean } =
    $props()

  let talk = $state<HTMLElement>()
  let atEnd = $state(true)

  const turns = $derived(chat.turns)
  const thread = $derived(chat.head ? chat.thread : null)
  const id = $derived(chat.head?.id ?? '')
  const running = $derived(chat.running.includes(id))
  const pending = $derived(chat.pending[id])
  const steering = $derived(chat.steering[id] ?? [])
  const lastModel = $derived.by(() => {
    for (let at = turns.length - 1; at >= 0; at--) if (turns[at]?.role === 'model') return at
    return -1
  })
  const waiting = $derived(
    running &&
      (pending !== undefined || !turns.at(-1)?.parts.length || turns.at(-1)?.role === 'you'),
  )
  const hello = $derived(ready && !turns.length && pending === undefined && !running)
  const chats = $derived(ordered(chat.heads, chat.states, chat.unread))
  let all = $state(false)
  let pointed = $state(-1)
  const recent = $derived(all ? chats : chats.slice(0, 3))

  const sideways = $derived({
    can: (step: 1 | -1) => !!id && chats.some((one) => one.id === id) && !!beside(chats, id, step),
    go: (step: 1 | -1) => {
      const one = beside(chats, id, step)
      if (one) void chat.openThread(one.id, false)
    },
  })
  const here = hostHere()
  const parent = $derived.by(() => {
    const above = chat.head?.parent
    if (!above) return null
    const title = chat.threadOf(above)?.title ?? chat.every.find((one) => one.id === above)?.title
    return title === undefined ? null : { id: above, title }
  })

  function attachedOf(index: number): string[] {
    const draft = turns[index]?.draft
    return (draft?.attachments ?? [])
      .filter((one) => !('cite' in one) && one.label !== 'selection')
      .map((one) => one.label.replace(/\.(?:md|markdown)$/i, ''))
  }

  let copied = $state<string | null>(null)
  let copying: ReturnType<typeof setTimeout> | undefined
  async function copy(turn: string, text: string) {
    await copyText(text)
    copied = turn
    clearTimeout(copying)
    copying = setTimeout(() => (copied = null), 1600)
  }

  const follows = (..._values: unknown[]) => undefined

  const FIRST_TURNS = 40
  const MORE_TURNS = 20
  const NEAR_TOP = 600

  const starts: Record<string, number> = {}
  let moved = $state(0)
  const from = $derived.by(() => {
    follows(moved)
    const held = starts[id]
    if (held !== undefined && held < turns.length) return held
    if (!turns.length) return 0
    const start = Math.max(0, turns.length - FIRST_TURNS)
    starts[id] = start
    return start
  })
  const shown = $derived(from ? turns.slice(from) : turns)

  let reaching = false
  async function earlier(box: HTMLElement) {
    if (!from || reaching) return
    reaching = true
    const below = box.scrollHeight - box.scrollTop
    starts[id] = Math.max(0, from - MORE_TURNS)
    moved++
    await tick()
    box.scrollTop = box.scrollHeight - below
    reaching = false
  }

  function onScroll() {
    const box = talk
    if (!box) return
    atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24
    if (from && box.scrollTop < NEAR_TOP) void earlier(box)
  }

  function down() {
    talk?.scrollTo({ top: talk.scrollHeight, behavior: 'smooth' })
  }

  $effect(() => {
    follows(turns, waiting, chat.trouble, pending, running)
    const box = talk
    if (box && atEnd) void tick().then(() => (box.scrollTop = box.scrollHeight))
  })

  $effect(() => {
    follows(id)
    atEnd = true
  })

  let looked = $state(0)
  $effect(() => {
    const look = () => looked++
    window.addEventListener('focus', look)
    document.addEventListener('visibilitychange', look)
    return () => {
      window.removeEventListener('focus', look)
      document.removeEventListener('visibilitychange', look)
    }
  })

  $effect(() => {
    follows(looked, turns)
    if (!id || !chat.unread.has(id) || !atEnd) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    if (talk?.checkVisibility && !talk.checkVisibility()) return
    void chat.saw(id)
  })
</script>

<div class="room">
  <div class="talk" bind:this={talk} use:scrollbar use:slides={sideways} onscroll={onScroll}>
    {#if !ready}
      <p class="empty-text">
        Add an AI provider in Settings first.
        <button class="link" onclick={() => settings.show('ai')}>Settings › AI</button>
      </p>
    {/if}

    {#if parent}
      <button class="orden-row is-short up" onclick={() => void chat.openThread(parent.id)}>
        <span class="orden-row-label">↰ {parent.title || 'Untitled'}</span>
      </button>
    {/if}

    {#if hello && recent.length}
      <div class="home" in:fade={{ duration: dur(150) }}>
        <h2 class="heading">Chats</h2>
        <ul class="recent" onpointerleave={() => (pointed = -1)}>
          <ChatWindow heads={recent}>
            {#snippet row(one: ThreadHead, index: number, place: Place)}
              <ChatRow
                {place}
                lit={index === pointed}
                onpoint={() => (pointed = index)}
                head={one}
                state={chat.states.get(one.id) ?? stateOf(one)}
                unread={chat.unread.has(one.id)}
                onopen={() => void chat.openThread(one.id)}
                onpin={() => void chat.pin(one.id, !one.pinned)}
                onarchive={() => chat.archive(one.id)}
              />
            {/snippet}
          </ChatWindow>
          {#if here === 'side' && !all && chats.length > recent.length}
            <li>
              <button class="orden-row is-short all" onclick={() => (all = true)}>
                <span class="orden-row-label">Show all</span>
                <span class="orden-row-meta">{chats.length}</span>
              </button>
            </li>
          {/if}
        </ul>
      </div>
    {/if}

    {#each shown as turn, at (turn.id)}
      {@const index = from + at}
      {#if turn.role === 'you'}
        {@const words = turn.draft?.text ?? ''}
        <div
          class="said"
          class:steered={turn.steered}
          in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
        >
          {#if attachedOf(index).length}
            <div class="went">
              {#each attachedOf(index) as label, at (at)}
                <span>{label}</span>
              {/each}
            </div>
          {/if}
          <div class="held">
            <p class="bubble" dir="auto">{words}</p>
            {#if thread && !turn.steered}
              <span class="tools">
                <button
                  class="orden-glyph tool"
                  title="Copy"
                  aria-label="Copy"
                  onclick={() => void copy(turn.id, words)}
                >
                  <svg viewBox="0 0 13 13">
                    {#if copied === turn.id}
                      <path d="M2.8 6.8l2.4 2.4 5-5.4" />
                    {:else}
                      <path
                        d="M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"
                      />
                    {/if}
                  </svg>
                </button>
                {#if !running}
                  <button
                    class="orden-glyph tool"
                    title="Edit"
                    aria-label="Edit"
                    onclick={() => chat.startEdit(turn.id)}
                  >
                    <svg viewBox="0 0 13 13"><path d="M8.7 2.3l2 2-6 6-2.6.6.6-2.6z" /></svg>
                  </button>
                  <button
                    class="orden-glyph tool"
                    title="Rewind"
                    aria-label="Rewind"
                    onclick={() => chat.rewind(turn.id)}
                  >
                    <svg viewBox="0 0 13 13"
                      ><path
                        d="M2.4 6.5a4.1 4.1 0 1 0 1.2-2.9M2.4 2v2.6H5M6.5 4.4v2.3l1.6 1"
                      /></svg
                    >
                  </button>
                {/if}
              </span>
            {/if}
          </div>
          {#if thread && !turn.steered}
            <Branches {thread} turn={turn.id} panel={chat} />
          {/if}
        </div>
      {:else}
        <Reply
          {turn}
          sources={sourcesFor(turns, index)}
          last={index === lastModel}
          live={running && index === turns.length - 1}
          {ongoto}
        />
      {/if}
    {/each}

    {#if thread && !running}
      <ChangesCard {thread} />
    {/if}

    {#if pending !== undefined}
      <div class="said is-pending"><p class="bubble" dir="auto">{pending}</p></div>
    {/if}

    {#each steering as words, at (at)}
      <div class="said steered is-pending"><p class="bubble" dir="auto">{words}</p></div>
    {/each}

    {#if waiting}
      <Thinking />
    {/if}

    {#if chat.trouble}
      <p class="wrong">{chat.trouble}</p>
    {/if}
  </div>

  {#if !atEnd && turns.length}
    <button
      class="down orden-layer"
      title="Scroll to the end"
      aria-label="Scroll to the end"
      onclick={down}
      transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}
    >
      <svg viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M6.5 2.4v8M3.2 7.1l3.3 3.3 3.3-3.3" /></svg
      >
    </button>
  {/if}
</div>

<style>
  .room {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-x: clip;
  }

  .talk {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block: var(--space-2) var(--space-4);
    padding-inline: max(
      calc(var(--space-1) + var(--row-pad)),
      calc((100% - var(--column, 100%)) / 2 + var(--space-4))
    );
    mask-image: linear-gradient(to bottom, #000 calc(100% - var(--space-4)), transparent);
  }

  .home {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-inline: calc(var(--row-pad) * -1);
  }

  .heading {
    margin: 0;
    padding: 0 var(--row-pad) var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-row);
  }

  .recent {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .all .orden-row-label {
    color: var(--muted);
  }

  .up {
    flex: none;
    color: var(--muted);
  }

  .said {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    min-width: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .held,
  .said > .bubble {
    position: relative;
    max-width: min(70%, 36rem);
    min-width: 0;
  }

  .bubble {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--ink-wash);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .said.steered .bubble {
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .said.is-pending {
    opacity: 0.6;
  }

  .went {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: 85%;
  }

  .went span {
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    position: absolute;
    top: 50%;
    inset-inline-end: 100%;
    display: flex;
    padding-inline-end: 2px;
    translate: 0 -50%;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .said:hover .tools,
  .tools:focus-within,
  :global([data-touch]) .tools {
    opacity: 1;
  }

  .tool {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .tool svg {
    stroke-width: 1.3;
  }

  .down {
    position: absolute;
    bottom: var(--space-2);
    left: 50%;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: -14px;
    padding: 0;
    border-radius: 50%;
    box-shadow: var(--shadow-md);
    color: var(--text);
    cursor: default;
  }

  .down svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .down:hover {
      color: var(--text-strong);
    }
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: default;
  }

  @media (hover: hover) {
    .link:hover {
      text-decoration: underline;
    }
  }

  .empty-text,
  .wrong {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--muted);
  }

  .wrong {
    color: var(--danger);
  }

  :global([data-touch]) .bubble,
  :global([data-touch]) .empty-text,
  :global([data-touch]) .wrong {
    font-size: var(--text-base);
  }
</style>
