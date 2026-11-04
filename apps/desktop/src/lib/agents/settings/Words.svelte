<script lang="ts">
  /** A short list somebody keeps by hand: the sites scripts may run on, the programs
   *  the terminal starts without asking. The dictionary's shape in the Spelling pane -
   *  the words, each of which is the button that takes it away, and a field for one
   *  more under them - because it is the same thing: a list read and taken back here,
   *  added to by typing.
   *
   *  What was typed is read by `parse` first, which answers the word to keep or
   *  nothing; nothing leaves the field as it was, marked, so the reader can see what
   *  was not taken and put it right. */
  import Cross from '../../Cross.svelte'
  import Hint from '../../Hint.svelte'
  import { t } from '../../i18n.svelte'

  const {
    words,
    placeholder,
    hint,
    parse,
    onadd,
    onremove,
  }: {
    words: readonly string[]
    placeholder: string
    hint?: string
    parse: (typed: string) => Promise<string | null>
    onadd: (word: string) => void
    onremove: (word: string) => void
  } = $props()

  let refused = $state(false)

  async function add(field: HTMLInputElement) {
    const typed = field.value
    if (!typed.trim()) return

    const word = await parse(typed)
    refused = word === null
    if (word === null) return

    onadd(word)
    field.value = ''
  }
</script>

<div class="nib-setting words">
  {#if words.length}
    <div class="list">
      {#each words as word (word)}
        <button class="nib-tag" title={t('Remove')} onclick={() => onremove(word)}>
          {word}<Cross small />
        </button>
      {/each}
    </div>
  {/if}
  <input
    class="nib-field is-value add"
    type="text"
    {placeholder}
    aria-label={placeholder}
    aria-invalid={refused}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
    oninput={() => (refused = false)}
    onchange={(event) => void add(event.currentTarget)}
  />
  {#if hint}<Hint text={hint} />{/if}
</div>

<style>
  /* A list runs down the card rather than across it, and the field for another one
     sits under the last of them: the Spelling pane's dictionary. */
  .words {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding-block: var(--space-1);
  }

  .list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* The value box every setting's is, across the list rather than in the column. */
  .words > .add {
    inline-size: auto;
  }
</style>
