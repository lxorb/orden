<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { i18n, key, t } from '../../i18n.svelte'
  import { dur, fly } from '../../motion'
  import { chat } from './chat.svelte'
  import { hostHere } from './host'
  import { tokens } from './numbers'
  import { attachedIn, bandsOf } from './ring'
  import { instructionsSent } from './setup'

  const { next }: { next: number } = $props()

  const here = hostHere()
  const open = $derived(chat.popover === 'context' && chat.host === here)
  const head = $derived(chat.head)
  const bands = $derived.by(() => {
    if (!head) return null
    const window = head.usage.window ?? chat.model?.window ?? null
    const since = chat.thread?.compaction?.upTo
    return bandsOf(
      head.usage,
      window,
      instructionsSent(head.id),
      attachedIn(chat.turns, since),
      next,
      chat.thread?.autocompact,
    )
  })

  const say = (count: number) => tokens(count, i18n.language)

  const summary = $derived.by(() => {
    if (!bands) return ''
    const used = bands.window ? `${say(bands.used)} / ${say(bands.window)}` : say(bands.used)
    const spent = chat.thread?.spent
    const cost = spent?.cost === undefined ? '' : `, $${spent.cost.toFixed(2)}`
    return spent ? `${used}, ↑${say(spent.input)} ↓${say(spent.output)}${cost}` : used
  })

  const R = 5.25
  const LENGTH = 2 * Math.PI * R
  const usedArc = $derived(bands?.window ? Math.min(1, bands.used / bands.window) * LENGTH : 0)
  const nextArc = $derived(
    bands?.fraction !== null && bands?.fraction !== undefined ? bands.fraction * LENGTH : 0,
  )
  const tick = $derived(
    bands?.window && bands.compacts !== null ? (bands.compacts / bands.window) * 360 : null,
  )

  function compact() {
    chat.popover = null
    chat.compact()
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    chat.popover = null
    chat.focus()
  }

  const ROWS = [
    ['instructions', key('Instructions')],
    ['attached', key('Attached')],
    ['conversation', key('Conversation')],
  ] as const
</script>

{#if bands}
  <div class="ring">
    <button
      class="orden-glyph knob"
      class:warn={bands.warn}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={summary}
      aria-label={t('Context')}
      onclick={() => (chat.popover = open ? null : 'context')}
    >
      {#if bands.window}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <circle class="track" cx="7" cy="7" r={R} />
          <circle class="arc-next" cx="7" cy="7" r={R} stroke-dasharray={`${nextArc} ${LENGTH}`} />
          <circle class="arc-used" cx="7" cy="7" r={R} stroke-dasharray={`${usedArc} ${LENGTH}`} />
          {#if tick !== null}
            <line class="tick" x1="7" y1="0.6" x2="7" y2="2.6" transform={`rotate(${tick} 7 7)`} />
          {/if}
        </svg>
      {:else}
        <span class="count">{say(bands.used + bands.next)}</span>
      {/if}
    </button>

    {#if open}
      <div
        class="tray orden-layer"
        role="dialog"
        aria-label={t('Context')}
        tabindex="-1"
        onkeydown={onKey}
        transition:fly={{ y: 6, duration: dur(150), easing: cubicOut }}
      >
        <div class="top">
          <span class="whole"
            >{bands.window ? `${say(bands.used)} / ${say(bands.window)}` : say(bands.used)}</span
          >
          {#if bands.compacts !== null}
            <span class="at">{t('Compacts at {count}', { count: say(bands.compacts) })}</span>
          {/if}
        </div>
        {#if bands.window}
          <div class="bar">
            <span
              class="fill instructions"
              style:width={`${(bands.instructions / bands.window) * 100}%`}
            ></span>
            <span class="fill attached" style:width={`${(bands.attached / bands.window) * 100}%`}
            ></span>
            <span
              class="fill conversation"
              style:width={`${(bands.conversation / bands.window) * 100}%`}
            ></span>
            <span class="fill next" style:width={`${(bands.next / bands.window) * 100}%`}></span>
          </div>
        {/if}
        {#each ROWS as [band, word] (band)}
          <div class="band">
            <span class="swatch {band}"></span>
            <span class="what">{t(word)}</span>
            <span class="much">{say(bands[band])}</span>
          </div>
        {/each}
        <div class="band">
          <span class="swatch next"></span>
          <span class="what">{t('Next message')}</span>
          <span class="much">≈ {say(bands.next)}</span>
        </div>
        <button
          class="orden-button is-quiet compact"
          disabled={!head?.kept || chat.busy}
          onclick={compact}>{t('Compact now')}</button
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  .ring {
    display: contents;
  }

  .knob {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    color: var(--accent);
  }

  .knob.warn {
    color: var(--danger);
  }

  .knob svg {
    width: 15px;
    height: 15px;
    transform: rotate(-90deg);
  }

  circle {
    fill: none;
    stroke-width: 2;
    transition: stroke-dasharray var(--dur-base) var(--ease-out);
  }

  .track {
    stroke: var(--line-strong);
  }

  .arc-used {
    stroke: currentColor;
  }

  .arc-next {
    stroke: currentColor;
    opacity: 0.35;
  }

  .tick {
    stroke: var(--muted-strong);
    stroke-width: 1.2;
    stroke-linecap: round;
  }

  .count {
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .tray {
    position: absolute;
    inset-inline-end: var(--space-1);
    bottom: calc(100% + 4px);
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(16rem, calc(100% - var(--space-2)));
    padding: var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
  }

  .top {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .whole {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    font-variant-numeric: tabular-nums;
  }

  .at,
  .what {
    color: var(--muted);
  }

  .bar {
    display: flex;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--ink-wash);
  }

  .fill {
    flex: none;
    transition: width var(--dur-base) var(--ease-out);
  }

  .band {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .much {
    margin-inline-start: auto;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .instructions {
    background: var(--muted-strong);
  }

  .attached {
    background: var(--success);
  }

  .conversation {
    background: var(--accent);
  }

  .next {
    background: var(--accent-soft);
  }

  .compact {
    align-self: flex-start;
    margin-top: 2px;
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }
</style>
