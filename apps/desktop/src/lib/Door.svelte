<script lang="ts" generics="T">
  /** Something fetched the first time it is shown, that plays its own way in and its
   *  own way out: the list of spaces under the panel's header, the find bar, the strip
   *  over something archived, a tab's speaker.
   *
   *  The plain way to write one, `{#if open}{#await door() then Thing}<Thing />`, puts
   *  the fetch between the `{#if}` and the transition, and a transition only plays for
   *  the block nearest it: the `{#if}` going false took the whole `{#await}` down at
   *  once, so the list of spaces came in and then simply vanished, in one frame, with
   *  the chevron and the rows under it still moving (#1067). Here the `{#if}` waits for
   *  the fetch's answer, so it is the nearest block, and the way out plays; and a press in the
   *  middle of either way turns the movement round where it is, rather than starting
   *  the other one from its far end, for every transition written as `transition:`.
   *
   *  Nothing is fetched before the first time it is open, and what it fetched is kept. See `latched` in surfaces.svelte.ts, which is the same rule for the layers
   *  App.svelte draws. */
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

  /** What the door opened on, once it has: kept, so it stays on the page after it
   *  closes and its way out has something to play. */
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

<!-- One block, standing from the start: its way in plays the first time as well, which
     it would not for a block made already true, and its way out is its own. -->
{#if got && open}
  {@render children(got.one)}
{/if}
