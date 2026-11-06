<script lang="ts">
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

  .words > .add {
    inline-size: auto;
  }
</style>
