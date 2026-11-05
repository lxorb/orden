<script lang="ts">
  /** The open thread, scrolling over the composer, as the Codex sidebar draws one: the
   *  reader's messages in bubbles at the end of the line, each answer across the whole
   *  width under it (Reply.svelte), a message pressed a moment ago drawn at once, and a
   *  dot breathing until the first words of an answer arrive. Beside a bubble, while it
   *  is pointed at: copy, edit and rewind; under it the arrows between its branches once
   *  it has been edited. What the thread changed is a card at the end, once the answer
   *  is in (review/ChangesCard.svelte).
   *
   *  The end stays in view while an answer streams, as long as the reader has not
   *  scrolled up to read something else; then a round arrow over the composer goes back
   *  down. An empty thread is Codex's home: the latest chats, and the way to all. */
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, fly } from 'svelte/transition'
  import Thinking from '../Thinking.svelte'
  import { copyText } from '../../clipboard'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { scrollbar } from '../../scrollbar'
  import { settings } from '../../settings.svelte'
  import { beside, ordered, stateOf } from '../session-state'
  import { chat } from './chat.svelte'
  import ChatRow from './ChatRow.svelte'
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
  /** The open thread itself, the live one, for the review's arrows under a message. */
  const thread = $derived(chat.head ? chat.thread : null)
  const id = $derived(chat.head?.id ?? '')
  const running = $derived(chat.running.includes(id))
  const pending = $derived(chat.pending[id])
  const steering = $derived(chat.steering[id] ?? [])
  const lastModel = $derived.by(() => {
    for (let at = turns.length - 1; at >= 0; at--) if (turns[at]?.role === 'model') return at
    return -1
  })
  /** Waiting for the first words: a message on its way, or an answer with nothing in it yet. */
  const waiting = $derived(
    running &&
      (pending !== undefined || !turns.at(-1)?.parts.length || turns.at(-1)?.role === 'you'),
  )
  const hello = $derived(ready && !turns.length && pending === undefined && !running)
  /** The chats in the order every list has (#1089), Codex's three of them on its home,
   *  and the rest under them once Show all is pressed: in place, the same list grown,
   *  rather than another view of it. A tab has them all in its rail already. */
  const chats = $derived(ordered(chat.heads, chat.states, chat.unread))
  let all = $state(false)
  /** The row pointed at, lit as the list of all of them lights it (Threads.svelte). */
  let pointed = $state(-1)
  const recent = $derived(all ? chats : chats.slice(0, 3))

  /** The chats beside the open one, which a sideways slide goes to (#1089): the list's
   *  own order, round from the last to the first. Only from a chat that is in it. */
  const sideways = $derived({
    can: (step: 1 | -1) => !!id && chats.some((one) => one.id === id) && !!beside(chats, id, step),
    go: (step: 1 | -1) => {
      const one = beside(chats, id, step)
      if (one) void chat.openThread(one.id, false)
    },
  })
  const here = hostHere()
  /** The thread a helper's is a step of, which its conversation goes back to: a helper
   *  is in no list of chats (#1062). Nothing where that thread is gone. */
  const parent = $derived.by(() => {
    const above = chat.head?.parent
    if (!above) return null
    const title = chat.threadOf(above)?.title ?? chat.every.find((one) => one.id === above)?.title
    return title === undefined ? null : { id: above, title }
  })

  /** What went with a message besides its passages, by name, so a message says what
   *  it was sent with. */
  function attachedOf(index: number): string[] {
    const draft = turns[index]?.draft
    return (draft?.attachments ?? [])
      .filter((one) => !('cite' in one) && one.label !== 'selection')
      .map((one) => one.label.replace(/\.(?:md|markdown)$/i, ''))
  }

  /** Which message's words were copied a moment ago, for the tick that says so. */
  let copied = $state<string | null>(null)
  let copying: ReturnType<typeof setTimeout> | undefined
  async function copy(turn: string, text: string) {
    await copyText(text)
    copied = turn
    clearTimeout(copying)
    copying = setTimeout(() => (copied = null), 1600)
  }

  function onScroll() {
    const box = talk
    if (box) atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24
  }

  function down() {
    talk?.scrollTo({ top: talk.scrollHeight, behavior: 'smooth' })
  }

  const follows = (..._values: unknown[]) => undefined

  $effect(() => {
    follows(turns, waiting, chat.trouble, pending, running)
    const box = talk
    if (box && atEnd) void tick().then(() => (box.scrollTop = box.scrollHeight))
  })

  // A thread opened is read from its end.
  $effect(() => {
    follows(id)
    atEnd = true
  })

  /** Bumped as the window comes back into focus or into view, which may be the reader
   *  seeing what came while they were away. */
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

  // Read (#1064) once the reader has the chat in front of them with its end in view: on
  // screen, in the window they are using, scrolled down to what is new. Not on a hover.
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
      <!-- The one thing to say before a provider is set up, and where to do it. -->
      <p class="empty-text">
        {t('Add an AI provider in Settings first.')}
        <button class="link" onclick={() => settings.show('ai')}>{t('Settings › AI')}</button>
      </p>
    {/if}

    {#if parent}
      <button class="nib-row is-short up" onclick={() => void chat.openThread(parent.id)}>
        <span class="nib-row-label">↰ {parent.title || t('Untitled')}</span>
      </button>
    {/if}

    {#if hello && recent.length}
      <!-- Codex's home: no greeting, the latest chats under their heading and the way to
           all of them, over a composer that is at the foot from the start. -->
      <div class="home" in:fade={{ duration: dur(150) }}>
        <h2 class="heading">{t('Chats')}</h2>
        <ul class="recent" onpointerleave={() => (pointed = -1)}>
          {#each recent as one, index (one.id)}
            <ChatRow
              lit={index === pointed}
              onpoint={() => (pointed = index)}
              head={one}
              state={chat.states.get(one.id) ?? stateOf(one)}
              unread={chat.unread.has(one.id)}
              onopen={() => void chat.openThread(one.id)}
              onpin={() => void chat.pin(one.id, !one.pinned)}
              onarchive={() => chat.archive(one.id)}
            />
          {/each}
          {#if here === 'side' && !all && chats.length > recent.length}
            <li>
              <button class="nib-row is-short all" onclick={() => (all = true)}>
                <span class="nib-row-label">{t('Show all')}</span>
                <span class="nib-row-meta">{chats.length}</span>
              </button>
            </li>
          {/if}
        </ul>
      </div>
    {/if}

    {#each turns as turn, index (turn.id)}
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
          <!-- The message, and beside it while it is pointed at copy, edit and rewind,
               over the room at its start rather than on a row of their own, so a
               thread of messages stays as dense as Codex's. -->
          <div class="held">
            <p class="bubble">{words}</p>
            {#if thread && !turn.steered}
              <span class="tools">
                <button
                  class="nib-glyph tool"
                  title={t('Copy')}
                  aria-label={t('Copy')}
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
                  <!-- Change it and send again, or go back to before it: Codex's
                       pencil and Claude Code's checkpoint. -->
                  <button
                    class="nib-glyph tool"
                    title={t('Edit')}
                    aria-label={t('Edit')}
                    onclick={() => chat.startEdit(turn.id)}
                  >
                    <svg viewBox="0 0 13 13"><path d="M8.7 2.3l2 2-6 6-2.6.6.6-2.6z" /></svg>
                  </button>
                  <button
                    class="nib-glyph tool"
                    title={t('Rewind')}
                    aria-label={t('Rewind')}
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

    <!-- What the thread changed, under the turn that changed it, once it is done. -->
    {#if thread && !running}
      <ChangesCard {thread} />
    {/if}

    {#if pending !== undefined}
      <div class="said is-pending"><p class="bubble">{pending}</p></div>
    {/if}

    {#each steering as words, at (at)}
      <div class="said steered is-pending"><p class="bubble">{words}</p></div>
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
      class="down nib-layer"
      title={t('Scroll to the end')}
      aria-label={t('Scroll to the end')}
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
  /* Clipped sideways, so a chat slid out of the way leaves by the panel's edge. */
  .room {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-x: clip;
  }

  /* The thread in a column: the panel's gutter at a side's width, and a reading measure
     down the middle of a tab (`--column`, set by the panel). */
  /* A finger across it is a slide to the chat beside (#1089, slide.ts); up and down is
     still the scroll. */
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
    /* The thread fades out over the composer, Codex's sticky composer, rather than being
       cut off at a line: a mask, so what shows through is whatever the panel stands on.
       A colour laid over the end was the side's colour as a token says it, and a side
       under glass, the wallpaper or the chrome's own ground stands on something else -
       a darker strip with a band of the real ground between it and the field (#1110). */
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

  .all .nib-row-label {
    color: var(--muted);
  }

  .up {
    flex: none;
    color: var(--muted);
  }

  /* The reader's message: a bubble at the end of the line, Codex's, with what went
     with it over it and its tools under it. */
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

  /* Sent into a running turn: the same bubble, edged in the accent, as the arrow a steer
     is in every app that has one. */
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

  /* The tools beside a message while it is pointed at, over the room before it, so
     nothing moves. */
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

  /* Back to the end: a round arrow floating over the composer, centred. */
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
