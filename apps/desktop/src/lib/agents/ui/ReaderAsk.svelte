<script lang="ts">
  /** One question an agent put to the reader with `ask_reader` (#1078): its words, and
   *  either a button per answer it offers or a line to type one in, and a way to put it
   *  away unanswered. The approval card's frame, so the panel reads as one kind of
   *  thing asked. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { asking, type ReaderAsk } from './asking.svelte'

  const { question }: { question: ReaderAsk } = $props()

  let typed = $state('')
</script>

<div class="question" transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}>
  <p class="summary">{question.message}</p>

  {#if question.kind === 'text'}
    <form
      class="line"
      onsubmit={(event) => {
        event.preventDefault()
        asking.answer(question.id, typed)
      }}
    >
      <input
        class="nib-input"
        bind:value={typed}
        placeholder={question.placeholder ?? ''}
        aria-label={question.message}
      />
    </form>
  {/if}

  <div class="rows">
    <button class="nib-button is-quiet" onclick={() => asking.answer(question.id, null)}>
      {t('Dismiss')}
    </button>
    {#if question.kind === 'text'}
      <button class="nib-button" onclick={() => asking.answer(question.id, typed)}>
        {t('Send')}
      </button>
    {:else}
      {#each question.choices as choice (choice)}
        <button class="nib-button" onclick={() => asking.answer(question.id, choice)}>
          {choice}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .question {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    font-family: var(--font-ui);
  }

  .summary {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .line {
    display: flex;
    margin-top: var(--space-2);
  }

  .line input {
    flex: 1;
    min-width: 0;
  }

  .rows {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
