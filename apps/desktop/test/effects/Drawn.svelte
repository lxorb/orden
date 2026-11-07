<script lang="ts">
  const { tab }: { tab?: { kind: string; shown: string } } = $props()
</script>

<p class="drawn">drawn: {tab?.shown ?? 'the chat'}</p>
