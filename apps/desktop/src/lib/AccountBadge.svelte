<script lang="ts">
  import { account } from './account.svelte'
  import { BASE } from './api'
  import { initial } from './icons'

  const who = $derived(account.name)
  const face = $derived(account.user?.avatar && `${BASE}/i/${account.user.avatar.s}.webp`)
</script>

<span class="nib-badge" class:person={!!who} aria-hidden="true">
  {#if face}
    <img src={face} alt="" draggable="false" />
  {:else if who}
    {initial(who)}
  {:else}
    <svg viewBox="0 0 14 14"
      ><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg
    >
  {/if}
</span>

<style>
  .person {
    overflow: hidden;
    border-radius: 50%;
  }

  .person img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
