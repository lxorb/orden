<script lang="ts">
  import { menu } from '../menu.svelte'
  import { ticking } from './days'
  import { clock, nameOf, tintOf } from './look'
  import { time } from './time.svelte'

  const { now, wide = false }: { now: number; wide?: boolean } = $props()

  let said = $state('')
  let looking = $state(false)

  const running = $derived(time.running[0] ?? null)
  const matches = $derived.by(() => {
    const wanted = said.trim().toLocaleLowerCase()
    return time
      .latest()
      .filter((one) => !wanted || one.name.toLocaleLowerCase().includes(wanted))
      .slice(0, 6)
  })

  function started(name = said) {
    if (!time.startNamed(name)) return
    said = ''
    looking = false
  }

  function switchMenu(event: MouseEvent) {
    const span = running
    if (!span) return
    menu.show(
      event,
      time.latest().map((one) => ({
        label: one.name,
        checked: one.id === span.activity,
        run: () => time.changeSpan(span.id, { activity: one.id }),
      })),
      { title: 'Activity' },
    )
  }
</script>

<div class="timer" class:wide class:running={running !== null}>
  {#if running}
    <span class="dot" style:background={tintOf(running.activity)}></span>
    <button type="button" class="what" aria-haspopup="menu" onclick={switchMenu}>
      <span class="name">{nameOf(running.activity, 'No activity')}</span>
      <span class="since">Since {clock(running.start)}</span>
    </button>
    <span class="tick" role="timer">{ticking(now - running.start)}</span>
    <button
      type="button"
      class="orden-button is-danger go"
      aria-label="Stop timer"
      title="Stop timer"
      onclick={() => time.stop()}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"
        ><rect x="2.5" y="2.5" width="7" height="7" rx="1" /></svg
      >
    </button>
  {:else}
    <div class="asking">
      <input
        class="orden-field"
        aria-label="What are you working on?"
        placeholder="What are you working on?"
        bind:value={said}
        onfocus={() => (looking = true)}
        onblur={() => setTimeout(() => (looking = false), 150)}
        onkeydown={(event) => {
          if (event.key === 'Enter') started()
          if (event.key === 'Escape') {
            said = ''
            event.currentTarget.blur()
          }
        }}
      />
      {#if looking && said.trim() && matches.length}
        <ul class="matches orden-layer" role="listbox" aria-label="Activity">
          {#each matches as one (one.id)}
            <li>
              <button
                type="button"
                class="orden-row is-short"
                role="option"
                aria-selected="false"
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => started(one.name)}
              >
                <span class="dot" style:background={tintOf(one.id)}></span>
                <span class="orden-row-label">{one.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button
      type="button"
      class="orden-button go"
      aria-label="Start timer"
      title="Start timer"
      disabled={!said.trim()}
      onclick={() => started()}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.2v7.6L9.8 6z" /></svg>
    </button>
  {/if}
</div>

<style>
  .timer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .timer.running {
    padding-inline-start: var(--space-3);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .since {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .tick {
    flex: none;
    color: var(--text-strong);
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }

  .asking {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .matches {
    position: absolute;
    inset-inline: 0;
    top: calc(100% + 4px);
    z-index: var(--z-popover);
    margin: 0;
    padding: var(--space-1);
    list-style: none;
  }

  .go {
    flex: none;
    width: var(--row-height);
    padding: 0;
  }

  .go svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }

  .wide {
    padding: var(--space-3);
  }

  .wide .tick {
    font-size: 1.6rem;
  }

  .wide .go {
    width: auto;
    min-width: 3rem;
  }
</style>
