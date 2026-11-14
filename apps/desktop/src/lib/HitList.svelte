<script lang="ts">
  import { tick } from 'svelte'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import type { Outgoing, Reference } from './link-index.svelte'
  import { linkPieces, shownLine } from './link-line'
  import { middleOpens } from './new-tab'
  import { roving } from './roving'
  import { shownName } from './platform/src/api'
  import { offsetOf, type Rows, windowFor } from './row-window'
  import { ListView, measuredRow } from './row-window.svelte'
  import { folderOf, insideSpace } from './platform/src/api'
  import { workspace } from './workspace.svelte'

  type Row = Reference | Outgoing

  const {
    rows: all,
    onpick,
  }: {
    rows: readonly Row[]
    onpick: (row: Row, press: MouseEvent) => void
  } = $props()

  const WALK = {
    rows: '.hit',
    open: (row: HTMLElement) => row.click(),
    peek: (row: HTMLElement) => {
      row.click()
      row.focus()
    },
  }

  const root = $derived(workspace.activeSpace?.root ?? null)

  function noteOf(row: Row): string | null {
    return 'to' in row ? row.to : row.path
  }

  function placeOf(row: Row) {
    const note = noteOf(row)
    return {
      mark: note === null ? 'note' : fileMark(row.name),
      path: note === null || root === null ? undefined : insideSpace(root, note),
      folder: note === null ? '' : folderOf(note),
    } as const
  }

  const OVERSCAN = 6

  const LEAST = 40

  let list = $state<HTMLUListElement>()

  const where = new ListView()

  let standing = $state<number | null>(null)
  let reaching = $state<number | null>(null)

  const pinned = $derived(
    [standing, reaching].filter((one): one is number => one !== null && one < all.length),
  )

  const rows = $derived<Rows>({
    count: all.length,
    height: where.row || LEAST,
    top: where.top,
    room: where.room,
    overscan: OVERSCAN,
    pinned,
  })

  const view = $derived(windowFor(rows))

  const drawn = $derived.by(() => {
    const out: { at: number; row: Reference; away: boolean }[] = []

    for (let at = 0; at < all.length; at++) {
      const row = all[at]
      if (!row) continue

      const inside = at >= view.first && at <= view.last
      const away = !inside && view.pinned.includes(at)
      if (inside || away) out.push({ at, row, away })
    }

    return out
  })

  $effect(() => {
    const ul = list
    if (!ul) return

    return where.follow(ul, (one) => measuredRow(one, LEAST))
  })

  async function reach(index: number): Promise<HTMLElement | null> {
    if (index < 0 || index >= all.length) return null

    reaching = index
    await tick()

    const line = list?.querySelector(`li[data-row="${index}"]`)
    if (!(line instanceof HTMLElement)) return null

    line.scrollIntoView({ block: 'nearest' })
    where.refresh()

    const found = line.querySelector('.hit')
    return found instanceof HTMLElement ? found : null
  }

  function indexOf(row: HTMLElement): number {
    const said = row.closest('li')?.dataset.row
    return said === undefined ? -1 : Number(said)
  }

  function onFocus(event: FocusEvent) {
    const from = event.target
    if (!(from instanceof HTMLElement)) return

    const at = indexOf(from)
    standing = at < 0 ? null : at
  }

  function onBlur() {
    standing = null
  }
</script>

<ul
  bind:this={list}
  onfocusin={onFocus}
  onfocusout={onBlur}
  use:roving={{
    ...WALK,
    long: {
      count: () => all.length,
      indexOf,
      labels: () => all.map((one) => `${shownName(one.name)} ${shownLine(one.text)}`),
      reach,
    },
  }}
>
  <li class="gap" style:height="{view.above}px" aria-hidden="true"></li>

  {#each drawn as one (`${one.row.path}:${one.row.line}:${one.at}`)}
    {@const place = placeOf(one.row)}
    <li
      data-row={one.at}
      class:away={one.away}
      style:top={one.away ? `${offsetOf(one.at, rows)}px` : undefined}
    >
      <button
        class="orden-row hit"
        class:missing={noteOf(one.row) === null}
        onclick={(event) => onpick(one.row, event)}
        use:middleOpens={(event) => onpick(one.row, event)}
      >
        <FileMark mark={place.mark} path={place.path} />
        <span class="words">
          <span class="head">
            <span class="orden-row-label">{shownName(one.row.name)}</span>
            {#if place.folder}<span class="orden-row-meta">{place.folder}</span>{/if}
          </span>
          <span class="hit-line"
            >{#each linkPieces(one.row.text) as piece, at (at)}{#if piece.link}<span class="link"
                  >{piece.text}</span
                >{:else}{piece.text}{/if}{/each}</span
          >
        </span>
      </button>
    </li>
  {/each}

  <li class="gap" style:height="{view.below}px" aria-hidden="true"></li>
</ul>

<style>
  .hit {
    align-items: flex-start;
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }

  .hit :global(.mark) {
    margin-top: calc((1lh - var(--icon-md)) / 2);
  }

  .words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--row-gap);
    min-width: 0;
  }

  .hit-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .link {
    color: var(--accent);
  }

  .missing .orden-row-label {
    color: var(--muted);
    text-decoration: underline dotted;
    text-underline-offset: 0.16em;
  }

  :global([data-touch]) .hit-line {
    font-size: var(--text-sm);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
  }

  .gap {
    pointer-events: none;
  }

  .away {
    position: absolute;
    left: 0;
    right: 0;
  }
</style>
