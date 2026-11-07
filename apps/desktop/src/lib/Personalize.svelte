<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { account } from './account.svelte'
  import Cross from './Cross.svelte'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { dur } from './motion'
  import { overlays } from './overlays'
  import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
  import { settings } from './settings.svelte'
  import { segmented } from './slide'
  import { theme, type SchemeChoice } from './theme.svelte'

  const QUESTIONS = ['theme', 'developer', 'markdown'] as const
  type Question = (typeof QUESTIONS)[number]

  const finish = () => (settings.setup = null)

  function next() {
    const at = (settings.setup ?? -1) + 1
    if (at >= QUESTIONS.length) finish()
    else settings.setup = at
  }

  $effect(() => {
    if (account.signedIn) finish()
  })

  let covered = $state(overlays.layers > 0)

  $effect(() => overlays.watch(() => (covered = overlays.layers > 0)))

  interface Asked {
    label: string
    options: { value: string; label: string }[]
    get: () => string | null
    set: (value: string) => void
  }

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

{#if settings.setup !== null && !covered}
  {@const question = QUESTIONS[settings.setup] ?? null}
  <div
    class="card"
    data-covers
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
  .card {
    grid-column: 1 / -1;
    justify-self: end;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(18rem, 100%);
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
    flex-wrap: wrap;
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
