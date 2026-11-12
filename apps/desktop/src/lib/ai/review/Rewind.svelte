<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { message } from '../../message'
  import { dur, fly } from '../../motion'
  import type { Thread } from '../chat/types'
  import { checkpoints } from './changes'
  import type { Choice } from './plan'
  import { review, type ReviewPanel } from './review.svelte'
  import Tally from './Tally.svelte'

  const { sheet }: { sheet: { thread: Thread; panel: ReviewPanel | null; turn: string | null } } =
    $props()

  const thread = $derived(sheet.thread)
  const messages = $derived(checkpoints(thread.turns))
  let picked = $state<string | null>(null)
  let lit = $state(0)
  let busy = $state(false)
  let trouble = $state<string | null>(null)
  let root = $state<HTMLElement>()

  const plan = $derived(picked ? review.plan(thread, picked) : null)
  const rows = $derived(plan ? plan.choices.length : messages.length)

  const LABELS: Record<Choice, () => string> = {
    both: () => 'Restore notes and conversation',
    conversation: () => 'Restore conversation',
    notes: () => 'Restore notes',
    'summarize-from': () => 'Summarize from here',
    'summarize-to': () => 'Summarize up to here',
  }

  onMount(() => {
    const named = messages.findIndex((one) => one.id === sheet.turn)
    if (named >= 0) {
      picked = sheet.turn
      lit = 0
    } else lit = Math.max(0, messages.length - 1)
    root?.focus()
  })

  function wordsOf(index: number): string {
    return (messages[index]?.draft?.text ?? '').replace(/\s+/g, ' ').trim() || '…'
  }

  function pick(index: number) {
    const turn = messages[index]
    if (!turn) return
    picked = turn.id
    lit = 0
    trouble = null
  }

  async function choose(choice: Choice | undefined) {
    if (!choice || !picked || busy) return
    busy = true
    trouble = null
    try {
      await review.rewind(thread, picked, choice, sheet.panel)
    } catch (error) {
      trouble = message(error, 'The model did not answer.')
    } finally {
      busy = false
    }
  }

  function back() {
    if (picked && sheet.turn === null) {
      lit = Math.max(
        0,
        messages.findIndex((one) => one.id === picked),
      )
      picked = null
    } else review.closeRewind()
  }

  function keys(event: KeyboardEvent) {
    const digit = Number(event.key)
    if (event.key === 'ArrowDown') lit = Math.min(rows - 1, lit + 1)
    else if (event.key === 'ArrowUp') lit = Math.max(0, lit - 1)
    else if (event.key === 'Escape') back()
    else if (event.key === 'Enter') {
      if (plan) void choose(plan.choices[lit])
      else pick(lit)
    } else if (plan && digit >= 1 && digit <= plan.choices.length)
      void choose(plan.choices[digit - 1])
    else return
    event.preventDefault()
    event.stopPropagation()
  }
</script>

<div
  class="rewind"
  role="dialog"
  aria-label="Rewind"
  tabindex="0"
  bind:this={root}
  onkeydown={keys}
  class:is-busy={busy}
  transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
>
  {#if plan}
    <button class="orden-row is-short is-quiet asked" onclick={back}>
      <svg class="back" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M8 3.2L4.7 6.5 8 9.8" /></svg
      >
      <span class="orden-row-label">{plan.turn.draft?.text ?? ''}</span>
      {#if plan.changes.length}
        <Tally
          added={plan.changes.reduce((sum, one) => sum + one.added, 0)}
          removed={plan.changes.reduce((sum, one) => sum + one.removed, 0)}
        />
      {/if}
    </button>
    {#each plan.choices as choice, index (choice)}
      <button
        class="orden-row is-short"
        class:is-on={lit === index}
        disabled={busy}
        onclick={() => void choose(choice)}
        onpointerenter={() => (lit = index)}
      >
        <span class="orden-row-label">{LABELS[choice]()}</span>
        <kbd class="orden-row-meta">{index + 1}</kbd>
      </button>
    {/each}
    {#if plan.lasting}
      <p class="lasting">Pages, terminals and moves are not undone</p>
    {/if}
    {#if trouble}
      <p class="trouble">{trouble}</p>
    {/if}
  {:else}
    {#each messages as turn, index (turn.id)}
      <button
        class="orden-row is-short"
        class:is-on={lit === index}
        onclick={() => pick(index)}
        onpointerenter={() => (lit = index)}
      >
        <span class="orden-row-label">{wordsOf(index)}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .rewind {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 50vh;
    overflow: auto;
    margin-block-end: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .rewind.is-busy {
    opacity: 0.6;
  }

  .asked {
    color: var(--muted);
  }

  .back {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  kbd {
    font-family: var(--font-ui);
  }

  .lasting,
  .trouble {
    margin: 0;
    padding: var(--space-1) var(--row-pad);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .trouble {
    color: var(--danger);
  }
</style>
