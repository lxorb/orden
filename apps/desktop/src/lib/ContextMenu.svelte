<script lang="ts">
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { steppedKey } from './direction'
  import { t } from './i18n.svelte'
  import { type Spelling, spelled } from './list-keys'
  import { DIVIDER, menu, trim, type MenuEntry, type MenuItem } from './menu.svelte'
  import { overlays } from './overlays'
  import { released, shortcutPassesBy } from './menu-release'
  import { spendClick } from './spent-click'
  import { pullsAway } from './sheet-pull'
  import { trap } from './trap'
  import { viewport } from './viewport.svelte'
  import { walked } from './walk'
  import { dur } from './motion'

  let element = $state<HTMLDivElement>()
  let position = $state({ x: 0, y: 0 })
  let above = $state(false)

  const sheet = $derived(viewport.touch && !menu.near)
  const callout = $derived(viewport.touch && menu.near)

  const entries = $derived.by((): MenuEntry[] => {
    if (!viewport.touch) return menu.items

    const danger = menu.items.filter((item) => item?.danger)
    const rest = menu.items.filter((item) => !item?.danger)
    return trim([...rest, DIVIDER, ...danger])
  })

  function insets(node: HTMLElement) {
    const style = getComputedStyle(node)
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0
    return {
      top: px('--inset-top'),
      right: px('--inset-right'),
      bottom: px('--inset-bottom'),
      left: px('--inset-left'),
    }
  }

  $effect(() =>
    menu.open
      ? overlays.show(
          () => menu.hide(),
          () => [element],
          menu.from ?? undefined,
        )
      : undefined,
  )

  $effect(() => {
    if (!menu.open || !element || sheet) return

    const { width, height } = element.getBoundingClientRect()

    if (!callout) {
      above = false
      const y = menu.up ? menu.y - element.offsetHeight : menu.y
      position = {
        x: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
      }
      return
    }

    const { offsetWidth: full, offsetHeight: tall } = element
    const seen = window.visualViewport
    const inset = insets(element)
    const left = (seen?.offsetLeft ?? 0) + inset.left + 8
    const right = (seen ? seen.offsetLeft + seen.width : window.innerWidth) - inset.right - 8
    const top = (seen?.offsetTop ?? 0) + inset.top + 8
    const bottom = (seen ? seen.offsetTop + seen.height : window.innerHeight) - inset.bottom - 8

    const clear = 16
    above = menu.y - clear - tall >= top
    position = {
      x: Math.max(left, Math.min(menu.x - full / 2, right - full)),
      y: above ? menu.y - clear - tall : Math.min(menu.y + clear, bottom - tall),
    }
  })

  $effect(() => {
    const seen = window.visualViewport
    if (!menu.open || !viewport.touch || !seen) return

    const hide = () => menu.hide()
    seen.addEventListener('resize', hide)
    seen.addEventListener('scroll', hide)

    return () => {
      seen.removeEventListener('resize', hide)
      seen.removeEventListener('scroll', hide)
    }
  })

  function arrive(node: Element) {
    if (sheet) return fly(node, { y: 40, duration: dur(220), easing: cubicOut })
    return scale(node, { duration: dur(120), start: 0.96, easing: cubicOut })
  }

  function showMore(item: MenuItem, row: Element) {
    const more = item.more
    if (!more) return

    const box = row.getBoundingClientRect()
    void more().then((rows) => {
      const at = new MouseEvent('contextmenu', { clientX: box.right, clientY: box.top })
      menu.show(at, rows, { title: item.label })
    })
  }

  function choose(item: MenuItem, event: MouseEvent) {
    if (item.more && event.target instanceof Element && event.target.closest('[data-more]')) {
      event.stopPropagation()
      showMore(item, event.currentTarget as Element)
      return
    }

    if (item.keep) event.stopPropagation()
    else menu.hide()
    item.run()
  }

  function onPress(event: PointerEvent) {
    if ((event.buttons & (event.buttons - 1)) === 0) menu.heldAt = null
  }

  function onRelease(event: PointerEvent) {
    const from = menu.heldAt
    menu.heldAt = null
    if (!from || !menu.open || !element || event.pointerType !== 'mouse') return

    const there = document.elementFromPoint(event.clientX, event.clientY)
    const row = there?.closest<HTMLButtonElement>('[role="menuitem"]')
    const on = row && element.contains(row) && !row.disabled ? row : null
    const under = on ? 'row' : there && element.contains(there) ? 'menu' : 'outside'
    const said = released(from, { x: event.clientX, y: event.clientY }, under)
    if (said === 'stay') return

    if (said === 'choose') on?.click()
    else menu.hide()
    spendClick(event, true)
  }

  let spelling: Spelling = { typed: '', typedAt: 0 }

  $effect(() => {
    if (menu.open) spelling = { typed: '', typedAt: 0 }
  })

  const rows = () => [...(element?.querySelectorAll<HTMLElement>('.nib-row:not(:disabled)') ?? [])]

  function onKey(event: KeyboardEvent) {
    const list = rows()
    if (!list.length) return

    const at = list.findIndex((row) => row === document.activeElement)

    const standing = list[at]
    const item = entries[Number(standing?.dataset.at)]
    if (standing && item?.more && steppedKey(event.key) === 'ArrowRight') {
      event.preventDefault()
      showMore(item, standing)
      return
    }

    const moved = walked(event.key, at < 0 ? null : at, list.length, true)
    const landed = moved === null ? undefined : list[moved]

    if (landed) {
      event.preventDefault()
      landed.focus()
      return
    }

    if (event.key === ' ' && at >= 0) {
      event.preventDefault()
      list[at]?.click()
      return
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const names = list.map((row) => row.textContent)
      const { typed, typedAt, found } = spelled(spelling, event.key, event.timeStamp, names)
      spelling = { typed, typedAt }

      if (found >= 0) {
        event.preventDefault()
        list[found]?.focus()
      }
    }
  }
</script>

<svelte:window
  onresize={() => menu.hide()}
  onkeydowncapture={(event: KeyboardEvent) => {
    if (menu.open && shortcutPassesBy(event)) menu.hide()
  }}
  onpointerdowncapture={onPress}
  onpointerupcapture={onRelease}
/>

{#if menu.open}
  {#if viewport.touch}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="nib-scrim scrim"
      class:is-clear={!sheet}
      transition:fade={{ duration: dur(130) }}
      onclick={() => menu.hide()}
    ></div>
  {/if}

  <div
    bind:this={element}
    class="nib-layer nib-host menu"
    class:touch={viewport.touch}
    class:sheet
    class:above
    style:left={sheet ? undefined : `${position.x}px`}
    style:top={sheet ? undefined : `${position.y}px`}
    transition:arrive
    use:trap={!menu.keepFocus}
    use:pullsAway={sheet ? () => menu.hide() : null}
    onkeydown={onKey}
    role="menu"
    tabindex="-1"
    aria-label={menu.title ?? t('Menu')}
  >
    {#if sheet}
      <div class="grip" aria-hidden="true"></div>
      {#if menu.title}<p class="title">{menu.title}</p>{/if}
    {/if}

    <div class="rows">
      {#each entries as item, index (index)}
        {#if item === null}
          <hr />
        {:else}
          <button
            class="nib-row"
            role="menuitem"
            class:danger={item.danger}
            class:lit={index === menu.lit}
            disabled={item.disabled}
            data-at={index}
            aria-haspopup={item.more ? 'menu' : undefined}
            onclick={(event) => choose(item, event)}
            onmousedown={(event) => menu.keepFocus && event.preventDefault()}
            onpointermove={() => menu.keepFocus && !item.disabled && (menu.lit = index)}
          >
            <span class="nib-row-label">{item.label}</span>
            {#if item.checked}<span class="tick">✓</span>{/if}
            {#if item.hint && !viewport.touch}<kbd>{item.hint}</kbd>{/if}
            {#if item.more}
              <span class="more" data-more aria-hidden="true">
                <svg class="nib-mirror" viewBox="0 0 16 16"><path d="M6 3.5l4.5 4.5L6 12.5" /></svg>
              </span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: var(--z-menu);
    min-width: 11rem;
    padding: var(--space-1);
    transform-origin: top left;
    max-height: calc(100dvh - 16px);
    display: flex;
    flex-direction: column;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .menu:not(.sheet) > .rows {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  button {
    color: var(--text);
    white-space: nowrap;
  }

  button.danger:hover:not(:disabled) {
    background: var(--danger-soft);
    color: var(--danger);
  }

  button:disabled {
    color: var(--muted);
  }

  button.lit {
    background: var(--surface-hover);
    color: var(--item-hover-text-color);
  }

  kbd {
    flex: none;
    margin-inline-start: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .more {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    margin-inline: var(--space-2) calc(-1 * var(--space-1));
    border-radius: var(--radius-sm);
    color: var(--muted);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .more:hover {
    background: var(--surface-press);
    color: var(--text);
  }

  .more svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tick {
    flex: none;
    margin-inline-start: var(--space-3);
    font-size: var(--text-sm);
    color: var(--accent);
  }

  hr {
    margin: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
  }

  .scrim {
    --scrim-z: var(--z-menu);
    --scrim-ink: 55%;
    --scrim-blur: 2px;
    touch-action: none;
  }

  .touch {
    z-index: var(--z-menu);
  }

  .touch button.danger:not(:disabled) {
    color: var(--danger);
  }

  .touch button.danger:active:not(:disabled) {
    background: var(--danger-soft);
  }

  .touch hr {
    margin: var(--space-1) var(--space-3);
  }

  .touch:not(.sheet) {
    min-width: 12rem;
    max-width: calc(100vw - 16px);
    transform-origin: top center;
  }

  .touch.above {
    transform-origin: bottom center;
  }

  .sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: var(--keyboard, 0px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    max-height: min(72dvh, calc(100dvh - var(--keyboard, 0px) - var(--space-5)));
    padding: 0 0 var(--touch-bottom);
    border: none;
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }

  .title {
    flex: none;
    margin: 0;
    padding: var(--space-2) var(--row-pad) var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet .rows {
    flex: 1;
    min-height: 0;
    padding: var(--space-1) max(var(--space-2), var(--inset-right)) var(--space-2)
      max(var(--space-2), var(--inset-left));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
