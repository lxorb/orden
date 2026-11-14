<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { tick } from 'svelte'
  import { closeOnBack } from '../ui-kit/src/api'
  import { region } from '../platform/src/api'
  import { longPress } from '../longpress'
  import { menu } from '../menu.svelte'
  import { fade, LAYER, scale } from '../platform/src/api'
  import { overlays } from '../ui-kit/src/api'
  import { pieces } from '../palette/pieces'
  import { roving } from '../roving'
  import { isNumber } from '../space-pick'
  import SpacePlace from '../SpacePlace.svelte'
  import { ListTyping } from '../space-typing.svelte'
  import { trap } from '../ui-controls/src/api'
  import { relativeStep } from '../ago'
  import HostMark from './HostMark.svelte'
  import {
    destinationOf,
    type Host,
    hostFor,
    mayBeDestination,
    pickerOrder,
    plainlyDestination,
    said,
    searchName,
  } from './hosts'
  import { remote } from './hosts.svelte'
  import { hostPicker } from './picker.svelte'

  $effect(() => (hostPicker.open ? overlays.show(() => hostPicker.dismiss()) : undefined))
  $effect(() => closeOnBack(hostPicker.open, () => hostPicker.dismiss()))

  const placed = $derived(pickerOrder(remote.hosts, remote.kept))

  const typing = $derived(
    hostPicker.open
      ? new ListTyping(
          () => placed.map((one) => searchName(one.host)),
          (at) => {
            const one = placed[at]
            if (one) hostPicker.choose(one.host)
          },
          (typed) => !isNumber(typed) && mayBeDestination(typed),
        )
      : null,
  )
  $effect(() => {
    const one = typing
    return () => one?.stop()
  })

  const typed = $derived(typing?.typed ?? '')
  const shown = $derived(
    (typing?.reading.shown ?? []).flatMap((at) => {
      const one = placed[at]
      return one ? [{ ...one, at }] : []
    }),
  )

  const offer = $derived.by(() => {
    if (!typed || isNumber(typed)) return null
    if (shown.length && !plainlyDestination(typed)) return null
    const wanted = destinationOf(typed)
    return wanted && !hostFor(remote.hosts, wanted) ? wanted : null
  })

  const empty = $derived(remote.read && remote.hosts.length === 0 && !offer)

  let box = $state<HTMLElement>()

  const buttons = $state<Record<number, HTMLButtonElement | null>>({})
  let offerButton = $state<HTMLButtonElement | null>(null)

  $effect(() => {
    const best = typing?.reading.best ?? -1
    const first = shown[0]?.at
    const lone = offer !== null && best < 0
    void tick().then(() => {
      if (lone) offerButton?.focus()
      else if (best >= 0) buttons[best]?.focus()
      else if (!typed && first !== undefined) buttons[first]?.focus()
      else box?.querySelector<HTMLElement>('button')?.focus()
    })
  })

  const relative = $derived(
    new Intl.RelativeTimeFormat(region(), { style: 'narrow', numeric: 'auto' }),
  )

  function ago(at: number): string {
    const step = relativeStep(Date.now() - at)
    return relative.format(step.value, step.unit)
  }

  function about(event: MouseEvent, host: Host) {
    event.preventDefault()
    menu.show(event, [
      {
        label: host.pinned ? 'Unpin' : 'Pin',
        run: () =>
          void remote.keep((kept) => ({
            ...kept,
            about: { ...kept.about, [host.id]: { ...kept.about[host.id], pinned: !host.pinned } },
          })),
      },
      { label: 'Settings', run: () => hostPicker.manage() },
    ])
  }

  function aboutGroup(event: MouseEvent, group: string) {
    event.preventDefault()
    menu.show(event, [{ label: 'Open all', run: () => hostPicker.chooseGroup(group) }])
  }
</script>

{#if typing}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="orden-scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => hostPicker.dismiss()}
  ></div>

  <div
    class="orden-screen is-centred is-steady picker"
    style:--rows={Math.max(placed.length, 1) + (offer ? 1 : 0)}
    style:--heads={placed.filter((one) => one.head).length}
    style:--parts={placed.filter((one) => one.parted).length}
    role="menu"
    aria-label="Remote"
    bind:this={box}
    use:trap
    use:roving={{ current: '.is-on', wrap: true }}
    onkeydowncapture={typing.press}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#each shown as { host, head, parted, at } (host.id)}
      {#if parted && !typed}<hr />{/if}
      {#if head && !typed}
        <p class="head" role="none" oncontextmenu={(event) => aboutGroup(event, head)}>
          <span>{head}</span><button
            class="all"
            tabindex="-1"
            onclick={() => hostPicker.chooseGroup(head)}>Open all</button
          >
        </p>
      {/if}
      <button
        class="orden-row"
        role="menuitem"
        bind:this={buttons[at]}
        onclick={() => hostPicker.choose(host)}
        oncontextmenu={(event) => about(event, host)}
        use:longPress={(event) => about(event, host)}
      >
        <SpacePlace place={at} {typed} held={typing.held}
          ><HostMark colour={host.colour} /></SpacePlace
        >
        <span class="orden-row-label"
          >{#each isNumber(typed) ? [{ text: host.name, hit: false }] : pieces(host.name, typed) as piece, index (index)}{#if piece.hit}<b
                >{piece.text}</b
              >{:else}{piece.text}{/if}{/each}{#if host.detail}<span class="detail"
              >{host.detail}</span
            >{/if}</span
        >
        {#if host.last !== null}<span class="orden-row-meta">{ago(host.last)}</span>{/if}
      </button>
    {/each}

    {#if offer}
      <button
        class="orden-row"
        role="menuitem"
        bind:this={offerButton}
        onclick={() => hostPicker.connect(offer)}
      >
        <HostMark />
        <span class="orden-row-label">{said(offer)}</span>
      </button>
    {/if}

    {#if empty}
      <button class="orden-row" role="menuitem" onclick={() => hostPicker.manage()}>
        <HostMark />
        <span class="orden-row-label">Add host</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .picker {
    --screen-width: var(--screen-sheet);
    --screen-height: calc(
      var(--rows) * var(--row-height) + var(--heads) * (var(--row-height-sm) + var(--space-2)) +
        var(--parts) * (2 * var(--space-1) + 1px) + 2 * var(--space-1) + 2px
    );
    z-index: var(--z-sheet);
    padding: var(--space-1);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .detail {
    margin-inline-start: var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .head {
    margin: var(--space-2) 0 0;
    padding: 0 var(--row-pad);
    min-height: var(--row-height-sm);
    display: flex;
    align-items: center;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }

  .all {
    margin-inline-start: auto;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font: inherit;
    font-weight: var(--weight-row);
    cursor: pointer;
    opacity: 0;
  }

  .head:hover .all,
  .all:focus-visible {
    opacity: 1;
  }

  .all:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  hr {
    margin: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
  }

  button:focus-visible {
    outline-offset: -1px;
  }
</style>
