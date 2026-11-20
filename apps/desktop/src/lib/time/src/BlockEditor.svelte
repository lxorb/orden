<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fade, midnightOf, slide } from '../../platform/src/api'
  import { TimeField } from '../../ui-controls/src/api'
  import { Cross } from '../../ui-kit/src/api'
  import { atClock, clockOf, daysAfter } from './days'
  import { edited } from './edit'
  import { length } from './look'
  import type { Span } from './records'
  import { resizeBlock } from './schedule'
  import { time } from './time.svelte'

  const {
    span,
    now,
    hasBefore,
    hasAfter,
    onsplit,
    onmerge,
    ondelete,
    onclose,
  }: {
    span: Span
    now: number
    hasBefore: boolean
    hasAfter: boolean
    onsplit: () => void
    onmerge: (which: 'before' | 'after') => void
    ondelete: () => void
    onclose: () => void
  } = $props()
  const end = $derived(span.end ?? now)
  function moved(which: 'start' | 'end', value: string) {
    const base = midnightOf(span.start)
    const at = atClock(base, value)
    if (at === null) return
    if (which === 'start') {
      edited(resizeBlock(time.spans, span.id, at, end, now), 'moved')
      return
    }
    const until = at <= span.start ? atClock(daysAfter(base, 1), value) : at
    if (until !== null) edited(resizeBlock(time.spans, span.id, span.start, until, now), 'moved')
  }
</script>

<div class="wrap" transition:slide={{ duration: dur(200), easing: cubicOut }}>
  <div class="editor" data-time-editor transition:fade={{ duration: dur(200), easing: cubicOut }}>
    <div class="clocks">
      <TimeField label="Start" value={clockOf(span.start)} onchange={(next: string) => moved('start', next)} />
      <span class="to" aria-hidden="true">to</span>
      {#if span.end === null}
        <span class="orden-field is-value is-read nowish">now</span>
      {:else}
        <TimeField label="End" value={clockOf(span.end)} onchange={(next: string) => moved('end', next)} />
      {/if}
      <span class="long">{length(end - span.start)}</span>
    </div>
    <button type="button" class="orden-glyph shut" aria-label="Close" title="Close" onclick={onclose}><Cross /></button>
    <div class="acts">
      <button type="button" class="orden-chip" onclick={onsplit}>Split</button>
      {#if hasBefore}<button type="button" class="orden-chip" onclick={() => onmerge('before')}
          >Merge with previous</button
        >{/if}
      {#if hasAfter}<button type="button" class="orden-chip" onclick={() => onmerge('after')}>Merge with next</button
        >{/if}
      <button type="button" class="orden-action is-danger delete" onclick={ondelete}>Delete</button>
    </div>
  </div>
</div>

<style>
  .wrap {
    padding-bottom: var(--space-2);
  }
  .editor {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0 0 0 3.5rem;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .clocks {
    padding-inline-end: calc(var(--row-height) + var(--space-1));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .clocks > :global(*:not(.to, .long)) {
    flex: 1 1 6.5rem;
    min-width: 0;
  }
  .to {
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .nowish {
    display: flex;
    align-items: center;
    color: var(--muted-strong);
  }
  .long {
    color: var(--muted-strong);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .shut {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .delete {
    width: auto;
    margin-inline-start: auto;
  }
</style>
