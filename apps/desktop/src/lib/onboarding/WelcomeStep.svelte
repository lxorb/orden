<script lang="ts">
  import { feedback } from '../feedback.svelte'
  import Mark from './Mark.svelte'
  import Screen from './Screen.svelte'
  import { setup } from './setup.svelte'

  const NAME = 'Orden'
  const HOLE = '\uE000'

  const [before = '', after = ''] = $derived(`Welcome to ${HOLE}`.split(/\u2068?\uE000\u2069?/u))

  let sent = $state<Record<number, 'sending' | 'sent'>>({})

  async function report(id: number, text: string) {
    if (sent[id]) return
    sent = { ...sent, [id]: 'sending' }
    try {
      await feedback.send(text)
      sent = { ...sent, [id]: 'sent' }
    } catch {
      sent = Object.fromEntries(Object.entries(sent).filter(([one]) => Number(one) !== id))
    }
  }
</script>

{#snippet head()}
  <span class="tile rise"><Mark size={64} assemble /></span>
  <div class="welcome rise">{before}<em>{NAME}</em>{after}</div>
{/snippet}

<Screen
  {head}
  primary={{ label: 'Show me around', onclick: () => setup.showAround() }}
  quiet={{ label: 'Skip', onclick: () => setup.finish() }}
>
  {#if setup.issues.length}
    <div class="o-list issues rise">
      {#each setup.issues as issue (issue.id)}
        <div class="o-row">
          <span class="warn" aria-hidden="true">
            <svg viewBox="0 0 14 14"
              ><path
                d="M4.6 4.2a2.4 2.4 0 0 1 4.8 0M3.9 5.4h6.2v3.4a3.1 3.1 0 0 1-6.2 0zM7 5.4v6.4M3.9 7.4H1.6M10.1 7.4h2.3M4.2 9.9l-1.9 1.4M9.8 9.9l1.9 1.4M4.4 5.4 2.6 3.8M9.6 5.4l1.8-1.6"
              /></svg
            >
          </span>
          <span class="text">{issue.text}</span>
          {#if sent[issue.id] === 'sent'}
            <span class="done" role="status">Report received</span>
          {:else}
            <button
              class="orden-chip end"
              type="button"
              disabled={sent[issue.id] === 'sending'}
              aria-busy={sent[issue.id] === 'sending'}
              onclick={() => void report(issue.id, issue.text)}
            >
              Send feedback
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</Screen>

<style>
  .tile {
    width: 112px;
    height: 112px;
    border-radius: 26px;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #c8ddfa, #e8c9ef);
    box-shadow:
      0 20px 50px -18px rgb(91 75 224 / 0.45),
      inset 0 0 0 1px rgb(255 255 255 / 0.5);
  }

  .welcome {
    font-size: clamp(40px, 7vw, 72px);
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 1.02;
    text-align: center;
    color: var(--text-strong);
  }

  em {
    font-style: normal;
    background: linear-gradient(90deg, #6d8ff0, #a77be6, #e07cc0);
    background-clip: text;
    color: transparent;
  }

  .issues {
    width: min(520px, 100%);
  }

  .warn {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgb(255 159 10 / 0.14);
    color: #e08a00;
    flex: none;
  }

  .warn svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
  }

  .text {
    min-width: 0;
    flex: 1;
  }

  .end {
    margin-inline-start: auto;
    min-width: 74px;
    min-height: 30px;
    display: inline-grid;
    place-items: center;
  }

  .done {
    margin-inline-start: auto;
    min-width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    flex: none;
    color: var(--success);
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
