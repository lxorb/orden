<script lang="ts">
  const { corner = false }: { corner?: boolean } = $props()
</script>

<span class="unread" class:corner aria-hidden="true"></span>

<style>
  .unread {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .corner {
    position: absolute;
    top: 3px;
    inset-inline-end: 3px;
    pointer-events: none;
  }
</style>
