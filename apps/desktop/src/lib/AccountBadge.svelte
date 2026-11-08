<script lang="ts">
  import { account } from './account.svelte'
  import { faceUrl } from './api'
  import { initial } from './icons'

  const who = $derived(account.name)
  const face = $derived(faceUrl(account.user?.avatar?.s))
  let failed = $state<string | null>(null)
  let loaded = $state<string | null>(null)
</script>

<span class="orden-badge" class:person={!!who} aria-hidden="true">
  {#if who}
    {#if !face || failed === face || loaded !== face}
      {initial(who)}
    {/if}
    {#if face && failed !== face}
      <img
        src={face}
        alt=""
        draggable="false"
        class:shown={loaded === face}
        onload={() => (loaded = face)}
        onerror={() => (failed = face)}
      />
    {/if}
  {:else}
    <svg viewBox="0 0 14 14"
      ><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg
    >
  {/if}
</span>

<style>
  .person {
    position: relative;
    overflow: hidden;
    border-radius: 50%;
  }

  .person img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
  }

  .person img.shown {
    opacity: 1;
  }
</style>
