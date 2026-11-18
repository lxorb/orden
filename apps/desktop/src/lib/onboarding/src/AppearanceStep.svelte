<script lang="ts">
  import { untrack } from 'svelte'
  import { theme, type SchemeChoice } from '../../theme/src/api'
  import Card from './Card.svelte'
  import Screen from './Screen.svelte'
  import { setup } from './setup-state.svelte'

  const was = untrack(() => theme.scheme)

  const LOOKS: { id: SchemeChoice; name: string }[] = [
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
    { id: 'system', name: 'Auto' },
  ]

  let picked: SchemeChoice | null = null

  function pick(id: SchemeChoice) {
    picked = id
    theme.setScheme(id)
  }

  function skip() {
    if (picked !== null && theme.scheme === picked && picked !== was) theme.setScheme(was)
    setup.next('appearance')
  }
</script>

{#snippet mini(kind: 'light' | 'dark')}
  <span class="mini {kind}">
    <span class="s"><i></i><i></i><i></i></span>
    <span class="m"><i></i><i></i><i></i><i class="short"></i></span>
  </span>
{/snippet}

<Screen
  title="Appearance"
  primary={{ label: 'Continue', onclick: () => setup.next('appearance') }}
  quiet={{ label: 'Skip', onclick: skip }}
>
  <div class="cards rise" role="radiogroup" aria-label="Appearance">
    {#each LOOKS as look (look.id)}
      <Card label={look.name} checked={theme.scheme === look.id} tight onpick={() => pick(look.id)}>
        {#if look.id === 'system'}
          <span class="mini auto">
            {@render mini('light')}
            {@render mini('dark')}
          </span>
        {:else}
          {@render mini(look.id)}
        {/if}
      </Card>
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
  }
</style>
