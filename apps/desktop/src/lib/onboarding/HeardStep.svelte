<script lang="ts">
  import { HEARD, type Heard } from './catalog'
  import { keepHeard } from './kept'
  import Screen from './Screen.svelte'
  import { setup } from './setup.svelte'

  let picked = $state<Heard | null>(null)
  let where = $state('')
  let field = $state<HTMLInputElement>()

  const DOTS = 'M6 12h.01M12 12h.01M18 12h.01'

  const ICONS: Record<Exclude<Heard, 'other'>, string> = {
    ai: 'M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9zM18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z',
    friend:
      'M9 5.3a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M17 7a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5M17 14c2 0 3.6 1.3 4.2 3.6',
    search: 'M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13M16 16l4.5 4.5',
    social: 'M4 5.5h16v10H9l-5 4z',
  }

  function pick(id: Heard) {
    picked = id
    if (id === 'other') setTimeout(() => field?.focus({ preventScroll: true }), 200)
  }

  function done() {
    if (picked) keepHeard({ id: picked, said: picked === 'other' ? where.trim() : '' })
    setup.next()
  }
</script>

<Screen
  title="How did you hear about Orden?"
  primary={{ label: 'Continue', disabled: picked === null, onclick: done }}
  quiet={{ label: 'Skip', onclick: () => setup.next() }}
>
  <div class="list rise" role="radiogroup" aria-label="How did you hear about Orden?">
    {#each HEARD as one (one.id)}
      <button
        class="orden-row reason"
        type="button"
        role="radio"
        aria-checked={picked === one.id}
        onclick={() => pick(one.id)}
      >
        <span class="ico" class:dots={one.id === 'other'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d={one.id === 'other' ? DOTS : ICONS[one.id]} /></svg
          >
        </span>
        <span>{one.name}</span>
        <svg class="check" viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M5 12.5l4.5 4.5L19 7.5" /></svg
        >
      </button>
    {/each}
  </div>
  {#if picked === 'other'}
    <input
      bind:this={field}
      bind:value={where}
      class="field"
      type="text"
      placeholder="Where?"
      aria-label="Where?"
    />
  {/if}
</Screen>

<style>
  .list {
    width: 100%;
    border-radius: 14px;
    background: var(--card);
    box-shadow:
      var(--shadow-sm),
      0 8px 24px rgb(16 24 40 / 0.08);
    overflow: hidden;
  }

  .reason {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border: 0;
    text-align: start;
    font: inherit;
    font-size: 15px;
    color: var(--text);
    position: relative;
  }

  .reason + .reason::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline: 16px 0;
    height: 1px;
    background: var(--line);
  }

  .ico {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    flex: none;
  }

  .ico svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .ico.dots svg {
    stroke-width: 3.4;
  }

  .check {
    width: 20px;
    height: 20px;
    margin-inline-start: auto;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0;
    transform: scale(0.4);
    transition: all 0.3s var(--ease-spring);
  }

  .reason[aria-checked='true'] .check {
    opacity: 1;
    transform: none;
  }

  .field {
    width: 100%;
    height: 50px;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--card);
    padding: 0 16px;
    font: inherit;
    font-size: 16px;
    color: var(--text);
  }
</style>
