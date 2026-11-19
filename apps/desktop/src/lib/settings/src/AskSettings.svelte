<script lang="ts">
  import { portOf, type SettingsSectionId } from '@orden/contracts'
  import { Cross } from '../../ui-kit/src/api'
  import { dur, slide } from '../../platform/src/api'
  import { answerOf, apply, brief, type Answer, type Change, type Offer } from './ask-settings'

  const {
    offers,
    ongo,
  }: {
    offers: () => Offer[]
    ongo: (section: SettingsSectionId, label: string) => void
  } = $props()

  const SPARK = 'M6.5 1.6c.4 2.6 1.9 4.1 4.5 4.5-2.6.4-4.1 1.9-4.5 4.5-.4-2.6-1.9-4.1-4.5-4.5 2.6-.4 4.1-1.9 4.5-4.5z'

  let asked = $state('')
  let busy = $state(false)
  let answer = $state.raw<Answer | null>(null)
  let trouble = $state<string | null>(null)
  let unready = $state(false)
  let settled = $state<Record<string, 'changed' | 'skipped'>>({})
  let session = 0

  const busied = $derived(asked !== '' || answer !== null || trouble !== null || unready || busy)

  async function ask() {
    const said = asked.trim()
    const port = portOf('settings.ask')
    if (!said || busy || !port.ok) return
    const all = offers()
    const mine = ++session
    busy = true
    trouble = null
    unready = false
    answer = null
    settled = {}
    try {
      const reply = await port.value.ask(brief(all), said)
      if (mine !== session) return
      if (reply === null) unready = true
      else answer = readable(reply, all)
    } catch (error) {
      if (mine === session) trouble = error instanceof Error ? error.message : String(error)
    } finally {
      if (mine === session) busy = false
    }
  }

  function readable(reply: string, all: Offer[]): Answer {
    try {
      return answerOf(reply, all)
    } catch {
      return { say: reply.trim(), show: [], changes: [] }
    }
  }

  function settle(change: Change, how: 'changed' | 'skipped') {
    if (how === 'changed' && !apply(change)) {
      trouble = `${change.offer.label} could not be changed.`
      return
    }
    settled = { ...settled, [change.offer.id]: how }
  }

  function clear() {
    session += 1
    asked = ''
    busy = false
    answer = null
    trouble = null
    unready = false
  }

  function onKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void ask()
    } else if (event.key === 'Escape' && busied) {
      event.preventDefault()
      event.stopPropagation()
      clear()
    }
  }
</script>

<div class="asker">
  <label class="orden-field field">
    <svg class="orden-field-mark spark" viewBox="0 0 13 13"><path d={SPARK} /></svg>
    <input
      bind:value={asked}
      placeholder="Ask where a setting is, or to change one"
      aria-label="Ask about settings"
      spellcheck="false"
      onkeydown={onKey}
    />
    {#if busied}
      <button class="drop" title="Clear" aria-label="Clear" onclick={clear}>
        <Cross small />
      </button>
    {/if}
  </label>

  {#if busy}
    <p class="note" transition:slide={{ duration: dur(140) }}>Looking</p>
  {:else if unready}
    <p class="note" transition:slide={{ duration: dur(140) }}>
      Add an AI provider first.
      <button class="link" onclick={() => ongo('ai', '')}>Settings › AI</button>
    </p>
  {/if}
  {#if trouble}
    <p class="note bad">{trouble}</p>
  {/if}

  {#if answer}
    <div class="answer" transition:slide={{ duration: dur(160) }}>
      {#if answer.say}
        <p class="said" dir="auto">{answer.say}</p>
      {/if}
      {#each answer.show as offer (offer.id)}
        <button class="row" onclick={() => ongo(offer.section, offer.label)}>
          <span class="name">{offer.label}<small>{offer.where}</small></span>
          <svg class="chevron orden-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      {/each}
      {#each answer.changes as change (change.offer.id)}
        {@const done = settled[change.offer.id]}
        <div class="row change">
          <span class="name">{change.offer.label}<small>{change.from} → {change.shown}</small></span>
          {#if done}
            <span class="done">{done === 'changed' ? 'Changed' : 'Skipped'}</span>
          {:else}
            <button class="orden-button is-quiet" onclick={() => settle(change, 'skipped')}>Skip</button>
            <button class="orden-button" onclick={() => settle(change, 'changed')}>Change</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .asker {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: var(--screen-pair);
    margin-bottom: var(--space-4);
  }

  .spark {
    fill: currentColor;
    stroke: none;
  }

  .drop {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: default;
  }

  .drop :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  .note {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .note.bad {
    color: var(--danger);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: default;
  }

  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }

  .said {
    margin: 0 0 var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--text-strong);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 38px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
  }

  .row .name {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .row small {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .chevron {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
  }

  .done {
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>
