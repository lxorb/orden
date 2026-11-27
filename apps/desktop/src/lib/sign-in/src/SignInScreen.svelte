<script lang="ts">
  import Ground from './Ground.svelte'
  import SignIn from './SignIn.svelte'

  const {
    name,
    alone,
    onsignedin,
    onalone = null,
  }: { name: string; alone: boolean; onsignedin: () => void; onalone?: (() => void) | null } = $props()
</script>

<div class="first" data-covers="all" role="dialog" aria-modal="true" aria-label={name} data-sign-in>
  <Ground>
    <SignIn {name} {alone} ondone={onsignedin} {onalone} />
  </Ground>
</div>

<style>
  .first {
    position: fixed;
    inset: 0;
    z-index: var(--z-stage);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    -webkit-font-smoothing: antialiased;
  }
</style>
