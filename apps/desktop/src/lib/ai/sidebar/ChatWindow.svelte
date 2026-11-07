<script lang="ts" generics="T extends ThreadHead">
  import type { Snippet } from 'svelte'
  import { offsetOf, type Place, type Rows, windowFor } from '../../row-window'
  import { ListView } from '../../row-window.svelte'
  import type { ThreadHead } from '../chat/types'

  const {
    heads,
    role,
    row,
  }: {
    heads: readonly T[]
    role?: 'group'
    row: Snippet<[T, number, Place]>
  } = $props()

  const OVERSCAN = 8

  const LEAST = 28

  let list = $state<HTMLUListElement>()
  const where = new ListView()
  let standing = $state<number | null>(null)

  const rows = $derived<Rows>({
    count: heads.length,
    height: where.row || LEAST,
    top: where.top,
    room: where.room,
    overscan: OVERSCAN,
    pinned: standing !== null && standing < heads.length ? [standing] : [],
  })
  const view = $derived(windowFor(rows))
  const drawn = $derived.by(() => {
    const out: { at: number; head: T; away: number | undefined }[] = []
    const add = (at: number, away: boolean) => {
      const head = heads[at]
      if (head) out.push({ at, head, away: away ? offsetOf(at, rows) : undefined })
    }
    for (const at of view.pinned) if (at < view.first) add(at, true)
    for (let at = view.first; at <= view.last; at++) add(at, false)
    for (const at of view.pinned) if (at > view.last) add(at, true)
    return out
  })

  function rowOf(ul: HTMLElement): number {
    const first = ul.querySelector(':scope > [data-at]:not(.away)')
    const tall = first instanceof HTMLElement ? first.getBoundingClientRect().height : 0
    return tall > 0 ? tall : LEAST
  }

  $effect(() => {
    const ul = list
    if (!ul) return
    return where.follow(ul, rowOf)
  })

  $effect(() => {
    if (heads.length && list) where.refresh()
  })

  export function reach(index: number): void {
    const box = where.box
    if (!box || index < 0 || index >= heads.length) return
    where.refresh()
    const height = where.row || LEAST
    const top = offsetOf(index, rows) + (box.scrollTop - where.top)
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + height > box.scrollTop + box.clientHeight)
      box.scrollTop = top + height - box.clientHeight
    where.refresh()
  }

  function onFocus(event: FocusEvent) {
    const from = event.target
    const said = from instanceof HTMLElement ? from.closest<HTMLElement>('[data-at]') : null
    standing = said?.dataset.at === undefined ? null : Number(said.dataset.at)
  }
</script>

<li class="window" role="presentation">
  <ul bind:this={list} {role} onfocusin={onFocus} onfocusout={() => (standing = null)}>
    <li class="gap" style:height="{view.above}px" aria-hidden="true"></li>
    {#each drawn as one (one.head.id)}
      {@render row(one.head, one.at, { at: one.at, away: one.away })}
    {/each}
    <li class="gap" style:height="{view.below}px" aria-hidden="true"></li>
  </ul>
</li>

<style>
  .window {
    display: block;
  }

  ul {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .gap {
    pointer-events: none;
  }
</style>
