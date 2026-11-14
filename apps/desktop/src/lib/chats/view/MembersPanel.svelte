<script lang="ts">
  import type { Who } from '@orden/chats'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../../backstack.svelte'
  import { copyText } from '../../clipboard'
  import { localNumber } from '../../region'
  import { menu, type MenuEntry } from '../../menu.svelte'
  import { dur, fly } from '../../motion'
  import { overlays } from '../../overlays'
  import { Avatar } from '../../accounts-ui/src/api'
  import { showProfile } from '../../accounts-ui/src/api'
  import { people } from '../../accounts/src/api'
  import { viewport } from '../../viewport.svelte'
  import type { ChatPage } from './chat.svelte'
  import { mentionText } from './compose'
  import Glyph from './Glyph.svelte'
  import { membersOpen } from './members-open.svelte'
  import { accountOf, faceOf, nameOf } from './people'
  import { grouped, linesOf, type Listed, listedOf, placed, type Rank, visible } from './roster'

  const {
    page,
    space,
    sheet = false,
    onmention,
    onclose,
  }: {
    page: ChatPage
    space: string | null
    sheet?: boolean
    onmention: (words: string) => void
    onclose: () => void
  } = $props()

  const HEIGHTS = { group: 36, member: 44 }
  const SPARE = 8

  let panel = $state<HTMLElement>()
  let filter = $state('')
  let top = $state(0)
  let height = $state(0)

  const width = membersOpen.width

  function presenceOf(who: Who) {
    const id = accountOf(who)
    return id ? (people.of(id)?.presence ?? null) : null
  }

  const listed = $derived(
    listedOf(page.view.members, (who) => nameOf(who, page.members, space), presenceOf),
  )
  const groups = $derived(grouped(listed, filter))
  const laid = $derived(placed(linesOf(groups), HEIGHTS))
  const shown = $derived(
    visible(laid.rows, top - HEIGHTS.member * SPARE, top + height + HEIGHTS.member * SPARE).map(
      (row) =>
        row.line.kind === 'group'
          ? { key: `g:${row.line.rank}`, top: row.top, height: row.height, group: row.line }
          : { key: row.line.member.who, top: row.top, height: row.height, member: row.line.member },
    ),
  )

  const RANK_WORDS: Record<Rank, () => string> = {
    owner: () => 'Owners',
    member: () => 'Members',
    bot: () => 'Bots',
  }

  $effect(() => (sheet ? overlays.show(onclose, () => [panel]) : undefined))
  $effect(() => closeOnBack(sheet, onclose))

  function press(event: MouseEvent, member: Listed) {
    const id = accountOf(member.who)
    if (id && event.currentTarget instanceof Element) showProfile(id, event.currentTarget, space)
  }

  function showMenu(event: MouseEvent, member: Listed) {
    event.preventDefault()
    const entries: MenuEntry[] = []
    const one = page.members.find((it) => it.who === member.who)
    if (one && member.who !== page.me && page.view.role !== 'read')
      entries.push({ label: 'Mention', run: () => onmention(mentionText(one)) })
    const id = accountOf(member.who)
    if (id && event.currentTarget instanceof Element) {
      const from = event.currentTarget
      entries.push({ label: 'Profile', run: () => showProfile(id, from, space) })
    }
    entries.push({ label: 'Copy name', run: () => void copyText(member.name) })
    menu.show(event, entries)
  }

  function onEdgeKey(event: KeyboardEvent) {
    if (viewport.touch) return
    if (width.step(event.key, panel)) event.preventDefault()
  }
</script>

{#if sheet}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-scrim scrim" onclick={onclose}></div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  bind:this={panel}
  class="members"
  class:sheet
  class:resizing={width.dragging}
  style:--members-width={sheet || width.pixels === null ? undefined : `${width.pixels}px`}
  aria-label="Members"
  transition:fly={{ x: 24, duration: dur(190), easing: cubicOut }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      onclose()
    }
  }}
>
  {#if !sheet}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuemin={width.narrowest}
      aria-valuemax={width.widest}
      aria-valuenow={Math.round(width.pixels ?? panel?.clientWidth ?? width.narrowest)}
      tabindex="0"
      title="Drag to resize"
      onpointerdown={(event) => width.start(event, panel)}
      ondblclick={() => width.reset()}
      onkeydown={onEdgeKey}
    ></div>
  {/if}
  <header class="top">
    <input
      class="orden-field look"
      type="search"
      aria-label="Filter"
      placeholder="Filter"
      bind:value={filter}
      onkeydown={(event) => {
        if (event.key === 'Escape' && filter) {
          event.preventDefault()
          filter = ''
        }
      }}
    />
    <button type="button" class="orden-glyph" aria-label="Close" onclick={onclose}
      ><Glyph name="close" /></button
    >
  </header>
  <div
    class="list orden-scrolls"
    role="list"
    bind:clientHeight={height}
    onscroll={(event) => (top = event.currentTarget.scrollTop)}
  >
    {#if laid.rows.length}
      <div class="room" style:height="{laid.total}px">
        {#each shown as row (row.key)}
          {#if 'group' in row}
            <h3 class="group" style:top="{row.top}px" style:height="{row.height}px">
              <span class="group-name">{RANK_WORDS[row.group.rank]()}</span>
              <span class="group-count">{localNumber(row.group.count)}</span>
            </h3>
          {:else}
            <button
              type="button"
              role="listitem"
              class="member"
              data-who={row.member.who}
              style:top="{row.top}px"
              style:height="{row.height}px"
              onclick={(event) => press(event, row.member)}
              oncontextmenu={(event) => showMenu(event, row.member)}
            >
              <Avatar
                face={faceOf(row.member.who, page.members, space)}
                size={32}
                presence={row.member.presence}
              />
              <span class="words">
                <span class="name">{row.member.name}</span>
              </span>
            </button>
          {/if}
        {/each}
      </div>
    {:else if filter.trim()}
      <p class="none">No matches</p>
    {/if}
  </div>
</aside>

<style>
  .members {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    width: var(--members-width, 240px);
    min-width: 0;
    min-height: 0;
    border-inline-start: 1px solid var(--line);
    background: var(--surface);
    font-family: var(--font-ui);
  }

  .members.sheet {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: var(--z-raised);
    width: min(320px, 100%);
    padding-bottom: var(--inset-bottom);
    box-shadow: var(--shadow-lg);
  }

  .scrim {
    position: absolute;
    inset: 0;
    z-index: var(--z-raised);
  }

  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: -4px;
    width: 8px;
    z-index: var(--z-lifted);
    cursor: col-resize;
  }

  .edge::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-end: 3px;
    width: 2px;
    background: transparent;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .edge:hover::after,
  .resizing .edge::after {
    background: var(--accent);
  }

  .top {
    --glyph-size: 15px;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 44px;
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .look {
    flex: 1;
    min-width: 0;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .room {
    position: relative;
  }

  .group,
  .member {
    position: absolute;
    inset-inline: var(--space-2);
  }

  .group {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    margin: 0;
    padding: 0 var(--space-2) var(--space-1);
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
  }

  .group-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-count {
    flex: none;
    font-variant-numeric: tabular-nums;
    font-weight: normal;
  }

  .member {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
  }

  @media (hover: hover) {
    .member:hover {
      background: var(--surface-hover);
    }
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  .none {
    margin: var(--space-4);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: center;
  }
</style>
