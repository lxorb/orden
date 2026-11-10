<script lang="ts">
  import { t } from '../i18n.svelte'
  import { BROWSERS } from './catalog'
  import Logo from './Logo.svelte'
  import Mark from './Mark.svelte'
  import Screen from './Screen.svelte'
  import { setup } from './setup.svelte'

  const browser = $derived(BROWSERS.find((one) => one.id === setup.answers.browser) ?? null)

  let stage = $state<'asking' | 'importing' | 'done'>('asking')

  const BROUGHT = [t('Bookmarks'), t('Open tabs'), t('History')]

  async function bring() {
    const importer = browser?.importer
    if (!importer || stage !== 'asking') return
    stage = 'importing'
    const { bringBrowser } = await import('./bring')
    for (const trouble of await bringBrowser(importer)) setup.tell(trouble)
    stage = 'done'
    setTimeout(() => setup.next(), 700)
  }
</script>

{#snippet head()}
  <div class="flow rise" class:importing={stage === 'importing'} class:done={stage === 'done'}>
    <span class="end">
      {#if browser}<Logo name={browser.name} icon={browser.icon} colour={browser.colour} />{/if}
    </span>
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="end"><Mark size={44} /></span>
  </div>
{/snippet}

<Screen
  title={t('Import from {browser}', { browser: browser?.name ?? '' })}
  {head}
  primary={{
    label: stage === 'done' ? t('Imported') : stage === 'importing' ? t('Importing') : t('Import'),
    busy: stage === 'importing',
    disabled: stage === 'done',
    onclick: () => void bring(),
  }}
  quiet={{ label: t('Not now'), disabled: stage !== 'asking', onclick: () => setup.next() }}
>
  <ul class="o-list rise">
    {#each BROUGHT as one (one)}
      <li class="o-row">{one}</li>
    {/each}
  </ul>
  {#if stage !== 'asking'}
    <div class="bar" aria-hidden="true"><i class:full={stage === 'done'}></i></div>
  {/if}
</Screen>

<style>
  .flow {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .end {
    width: 76px;
    height: 76px;
    border-radius: 20px;
    display: grid;
    place-items: center;
    background: var(--card);
    box-shadow:
      var(--shadow-sm),
      0 8px 24px rgb(16 24 40 / 0.08);
  }

  .dots {
    display: flex;
    gap: 6px;
  }

  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--line-strong);
  }

  .importing .dots i {
    animation: travel 1s ease-in-out infinite;
  }

  .importing .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .importing .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }

  .done .dots i {
    background: var(--success);
  }

  @keyframes travel {
    50% {
      background: var(--accent);
      transform: scale(1.4);
    }
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .bar {
    width: min(320px, 100%);
    height: 6px;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
    width: 60%;
    background: var(--accent);
    border-radius: inherit;
    transition: width 0.6s var(--ease-out);
  }

  .bar i.full {
    width: 100%;
  }
</style>
