<script lang="ts">
  import LogoTile from './LogoTile.svelte'
  import Screen from './Screen.svelte'
  import { setup } from './setup-state.svelte'

  const { device }: { device: 'MacBook' | 'computer' } = $props()
</script>

{#snippet head()}
  <LogoTile size={88} class="rise" />
{/snippet}

<Screen
  title="Onboarding is not available on mobile yet"
  {head}
  backless
  primary={{ label: 'Got it', onclick: () => setup.finish() }}
>
  <p class="lead rise">Please continue on a {device}</p>
  <p class="aside rise">We know you guys want it on mobile. So we're already working on it :)</p>
</Screen>

<style>
  .lead {
    margin: 0;
    font-size: 17px;
    line-height: 1.4;
    text-align: center;
    color: var(--text);
  }
  .aside {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    color: var(--muted);
  }
</style>
