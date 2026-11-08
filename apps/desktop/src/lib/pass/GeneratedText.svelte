<script lang="ts">
  const { text }: { text: string } = $props()

  const pieces = $derived(
    Array.from(text).map((char) => ({
      char,
      kind: /\d/.test(char) ? 'digit' : /\p{L}/u.test(char) ? 'letter' : 'symbol',
    })),
  )
</script>

<output class="generated" dir="ltr" aria-live="polite"
  >{#each pieces as piece, at (at)}<span class={piece.kind}>{piece.char}</span>{/each}</output
>

<style>
  .generated {
    display: block;
    min-height: 3em;
    font-family: var(--font-mono);
    font-size: var(--text-head);
    line-height: 1.5;
    letter-spacing: 0.04em;
    color: var(--text-strong);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: all;
    -webkit-user-select: all;
  }

  .digit {
    color: var(--accent);
  }

  .symbol {
    color: var(--success);
  }
</style>
