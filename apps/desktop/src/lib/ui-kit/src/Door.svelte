<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  const {
    open,
    load,
    children,
  }: {
    open: boolean
    load: () => Promise<T>
    children: Snippet<[T]>
  } = $props()

  let got = $state<{ one: T } | null>(null)
  let asking = false

  $effect(() => {
    if (!open || asking) return
    asking = true
    void load().then(
      (one) => (got = { one }),
      () => (asking = false),
    )
  })
</script>

{#if got && open}
  {@render children(got.one)}
{/if}
