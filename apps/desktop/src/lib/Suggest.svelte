<script lang="ts">
  /** The values an operator can take, offered under the field.
   *
   *  The same shape the editor puts under `[[`: one surface, one row per
   *  value, the letters that were typed marked where they landed. Chosen on
   *  pointerdown rather than on click, because clicking takes the focus off
   *  the field first and a popup that has lost its field has nothing to
   *  finish. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'

  const {
    values,
    typed,
    active,
    onchoose,
  }: {
    values: string[]
    typed: string
    active: number
    onchoose: (value: string) => void
  } = $props()

  /** The value in three parts, so the letters that were typed can be marked
   *  where they actually sit. */
  function split(value: string) {
    const at = typed ? value.toLowerCase().indexOf(typed.trim().toLowerCase()) : -1
    if (at === -1) return { before: value, hit: '', after: '' }

    return {
      before: value.slice(0, at),
      hit: value.slice(at, at + typed.trim().length),
      after: value.slice(at + typed.trim().length),
    }
  }
</script>

<ul class="suggest" transition:fly={{ y: -4, duration: 130, easing: cubicOut }}>
  {#each values as value, index (value)}
    {@const parts = split(value)}
    <li>
      <button
        class:on={index === active}
        onpointerdown={(event) => {
          event.preventDefault()
          onchoose(value)
        }}
      >
        {parts.before}<span class="matched">{parts.hit}</span>{parts.after}
      </button>
    </li>
  {/each}
</ul>

<style>
  .suggest {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 4;
    max-height: 15em;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  button {
    width: 100%;
    display: block;
    padding: 5px 10px;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:hover,
  button.on {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  /* The letters that were typed, marked where they landed in the value. */
  .matched {
    color: var(--accent);
    font-weight: 600;
  }

  :global([data-touch]) button {
    min-height: 44px;
    font-size: var(--text-base);
  }
</style>
