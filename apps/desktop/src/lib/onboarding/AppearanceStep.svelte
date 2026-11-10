<script lang="ts">
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { theme, type SchemeChoice } from '../theme.svelte'
  import Screen from './Screen.svelte'
  import { setup } from './setup.svelte'

  const was = untrack(() => theme.scheme)

  const LOOKS: { id: SchemeChoice; name: string }[] = [
    { id: 'light', name: t('Light') },
    { id: 'dark', name: t('Dark') },
    { id: 'system', name: t('Auto') },
  ]

  function skip() {
    if (theme.scheme !== was) theme.setScheme(was)
    setup.next()
  }
</script>

{#snippet mini(kind: 'light' | 'dark')}
  <span class="mini {kind}">
    <span class="s"><i></i><i></i><i></i></span>
    <span class="m"><i></i><i></i><i></i><i class="short"></i></span>
  </span>
{/snippet}

<Screen
  title={t('Appearance')}
  primary={{ label: t('Continue'), onclick: () => setup.next() }}
  quiet={{ label: t('Skip'), onclick: skip }}
>
  <div class="cards rise" role="radiogroup" aria-label={t('Appearance')}>
    {#each LOOKS as look (look.id)}
      <button
        class="card"
        type="button"
        role="radio"
        aria-checked={theme.scheme === look.id}
        onclick={() => theme.setScheme(look.id)}
      >
        {#if look.id === 'system'}
          <span class="mini auto">
            {@render mini('light')}
            {@render mini('dark')}
          </span>
        {:else}
          {@render mini(look.id)}
        {/if}
        <span class="label"><span class="ring" aria-hidden="true"></span>{look.name}</span>
      </button>
    {/each}
  </div>
</Screen>

<style>
  .cards {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 14px 12px 12px;
    border-radius: 16px;
    border: 1.5px solid transparent;
    cursor: pointer;
    background: var(--card);
    box-shadow:
      var(--shadow-sm),
      0 8px 24px rgb(16 24 40 / 0.08);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    transition:
      border-color 0.25s var(--ease-out),
      transform 0.25s var(--ease-out);
  }

  .card:hover {
    transform: translateY(-2px);
  }

  .card[aria-checked='true'] {
    border-color: var(--accent);
  }

  .label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ring {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--line-strong);
    display: grid;
    place-items: center;
  }

  .card[aria-checked='true'] .ring {
    background: var(--accent);
    border-color: var(--accent);
  }

  .card[aria-checked='true'] .ring::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
  }

  .mini {
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: 10px;
    overflow: hidden;
    display: grid;
    grid-template-columns: 30% 1fr;
    border: 1px solid rgb(0 0 0 / 0.08);
  }

  .s {
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .m {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  i {
    display: block;
    height: 5px;
    border-radius: 3px;
  }

  i.short {
    width: 70%;
  }

  .light {
    background: #fff;
  }

  .light .s {
    background: #eef1f5;
  }

  .light i {
    background: #d6dce4;
  }

  .light .m i:first-child {
    background: #5b4be0;
    width: 45%;
  }

  .dark {
    background: #15181d;
  }

  .dark .s {
    background: #0e1013;
  }

  .dark i {
    background: #2f3641;
  }

  .dark .m i:first-child {
    background: #7c6bf5;
    width: 45%;
  }

  .mini.auto {
    position: relative;
    display: block;
  }

  .auto > .mini {
    position: absolute;
    inset: 0;
    border: 0;
    border-radius: 0;
  }

  .auto > .mini:last-child {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  @media (max-width: 640px) {
    .cards {
      gap: 8px;
    }

    .card {
      padding: 10px 8px;
    }
  }
</style>
