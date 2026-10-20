<script lang="ts">
  /** The first run's optional questions, in a card in the corner beside the welcome
   *  note.
   *
   *  A fresh start asks nothing before it opens (Emil, 2026-10-13: the welcome note
   *  rather than a first screen), so there is no required step left to finish: the
   *  card says the reader is all set and offers to personalize, and that is all it
   *  does until asked. Then the questions come one at a time, the way Claude Design
   *  asks (David, 2026-10-12): each answered or passed with Next, and Done at every
   *  one of them, which leaves the rest at their defaults. Choosing an answer applies
   *  it at once, so the note behind the card is already what was asked for. In a
   *  corner and never over the note, as Notion's and Linear's getting-started cards
   *  sit, so somebody who wants to write just writes.
   *
   *  Whether this is somebody who writes code is one of the questions: yes keeps the
   *  terminals and markdown's marks under the caret, as Obsidian has them; no leaves
   *  the terminals out and writes the way a Notion page does, until the markdown
   *  question after it says otherwise. See `setDeveloper` in modes.svelte.ts.
   *
   *  Up while `settings.setup` says so: put there by the fresh start that wrote the
   *  welcome note (first-space.svelte.ts) and by the browser build's first visit
   *  (workspace.svelte.ts), as -1 for all set and then the index of the question
   *  asked. The window fetches the card only then; see App.svelte. */
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { account } from './account.svelte'
  import Cross from './Cross.svelte'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { dur } from './motion'
  import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
  import { settings } from './settings.svelte'
  import { segmented } from './slide'
  import { theme, type SchemeChoice } from './theme.svelte'

  /** The optional questions, in the order they are asked. */
  const QUESTIONS = ['theme', 'developer', 'markdown'] as const
  type Question = (typeof QUESTIONS)[number]

  /** What was not answered keeps its default. */
  const finish = () => (settings.setup = null)

  /** Answered or passed: the next question, or done after the last. */
  function next() {
    const at = (settings.setup ?? -1) + 1
    if (at >= QUESTIONS.length) finish()
    else settings.setup = at
  }

  // A reader who signs in has their answers on the account already.
  $effect(() => {
    if (account.signedIn) finish()
  })

  interface Asked {
    label: string
    options: { value: string; label: string }[]
    get: () => string | null
    set: (value: string) => void
  }

  /** Each optional question: what it is called, its answers, and the setting it reads
   *  and writes - the same setters Settings uses, so an answer is saved and shared the
   *  same way. */
  function asked(question: Question): Asked {
    switch (question) {
      case 'theme':
        return {
          label: t('Theme'),
          options: SCHEME_CHOICES.map((one) => ({ value: one, label: t(SCHEME_NAMES[one]) })),
          get: () => theme.scheme,
          set: (value) => theme.setScheme(value as SchemeChoice),
        }
      case 'developer':
        return {
          label: t('Do you write code?'),
          options: [
            { value: 'yes', label: t('Yes') },
            { value: 'no', label: t('No') },
          ],
          get: () => (modes.developer === null ? null : modes.developer ? 'yes' : 'no'),
          set: (value) => modes.setDeveloper(value === 'yes'),
        }
      case 'markdown':
        // Notion's page, where a mark never shows, or Obsidian's live preview, where it
        // shows under the caret; named for what they do rather than for either app.
        return {
          label: t('Markdown'),
          options: [
            { value: 'clean', label: t('Clean') },
            { value: 'live', label: t('Live preview') },
          ],
          get: () => (modes.quietMarks ? 'clean' : 'live'),
          set: (value) => {
            if ((value === 'clean') !== modes.quietMarks) modes.toggleQuietMarks()
          },
        }
    }
  }
</script>

{#if settings.setup !== null}
  {@const question = QUESTIONS[settings.setup] ?? null}
  <div
    class="card"
    role="dialog"
    aria-label={t('Personalize')}
    transition:fly={{ y: 8, duration: dur(180), easing: cubicOut }}
  >
    {#if question === null}
      <div class="row">
        <span class="name">{t('All set')}</span>
        <span class="pair">
          <button
            class="nib-button is-quiet is-soft"
            type="button"
            onclick={() => (settings.setup = 0)}
          >
            {t('Personalize')}
          </button>
          <button class="nib-glyph shut" type="button" aria-label={t('Done')} onclick={finish}>
            <Cross small />
          </button>
        </span>
      </div>
    {:else}
      {@const one = asked(question)}
      {@const held = one.get()}
      <span class="name">{one.label}</span>
      <div class="nib-segmented" role="radiogroup" aria-label={one.label} use:segmented>
        {#each one.options as option (option.value)}
          <button
            type="button"
            role="radio"
            aria-checked={option.value === held}
            class:on={option.value === held}
            onclick={() => one.set(option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <div class="row">
        <span class="dots" aria-hidden="true">
          {#each QUESTIONS as step, at (step)}
            <span class="dot" class:on={at === settings.setup}></span>
          {/each}
        </span>
        <span class="pair">
          <button class="nib-button is-quiet is-soft" type="button" onclick={finish}>
            {t('Done')}
          </button>
          <button class="nib-button" type="button" onclick={next}>
            {t('Next')}
          </button>
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Bottom right, over the status bar's corner and clear of the note's column. */
  .card {
    position: fixed;
    inset-inline-end: var(--space-4);
    bottom: calc(var(--space-4) + var(--inset-bottom, 0px));
    z-index: var(--z-float);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 18rem;
    max-width: calc(100vw - 2 * var(--space-4));
    padding: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-family: var(--font-ui);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .name {
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .pair {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .shut {
    width: 20px;
    height: 20px;
  }

  .dots {
    display: flex;
    gap: var(--space-1);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.4;
  }

  .dot.on {
    opacity: 1;
  }
</style>
