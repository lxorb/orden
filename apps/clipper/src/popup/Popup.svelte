<script lang="ts">
  import Clip from './Clip.svelte'
  import SignIn from '../lib/SignIn.svelte'
  import { opened } from '../lib/opened'

  // The one thing that changes the whole popup: a session appearing. Signing in
  // puts the whole of storage back before it says so, spaces included, so what
  // is drawn next starts from a settled account.
  let signedIn = $state(!!opened().token)
</script>

<main class:clipping={signedIn}>
  {#if signedIn}
    <Clip />
  {:else}
    <SignIn onSignedIn={() => (signedIn = true)} />
  {/if}
</main>

<style>
  main {
    width: 340px;
    padding: var(--space-4);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-base);
  }

  /* Signing in is a form and sizes itself; clipping is a preview with a fixed
     frame, so the popup stops resizing under the cursor as markdown arrives. */
  .clipping {
    display: flex;
    flex-direction: column;
    height: 430px;
  }
</style>
