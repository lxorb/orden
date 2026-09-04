<script lang="ts">
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { DIVIDER, menu, trim, type MenuEntry, type MenuItem } from './menu.svelte'
  import { viewport } from './viewport.svelte'

  let element = $state<HTMLDivElement>()
  let position = $state({ x: 0, y: 0 })
  /** Whether a phone's callout sits above the finger rather than below it,
     which is the side it grows from. */
  let above = $state(false)

  /** A phone gets a sheet from the bottom, where the thumb is, unless the
   *  menu asked to stay by the finger: then it is a callout, the way a phone
   *  puts Cut and Copy beside a selection rather than over it. */
  const sheet = $derived(viewport.phone && !menu.near)
  const callout = $derived(viewport.phone && menu.near)

  /** On a phone the destructive entries come last, in a group of their own,
   *  so a thumb finds Delete at the end and nowhere else. A desktop keeps the
   *  order it was given. */
  const entries = $derived.by((): MenuEntry[] => {
    if (!viewport.phone) return menu.items

    const danger = menu.items.filter((item) => item?.danger)
    const rest = menu.items.filter((item) => !item?.danger)
    return trim([...rest, DIVIDER, ...danger])
  })

  /** The safe-area insets, which CSS can see and JavaScript cannot: the
   *  stylesheet copies them into custom properties for this to read. */
  function insets(node: HTMLElement) {
    const style = getComputedStyle(node)
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0
    return { top: px('--inset-top'), right: px('--inset-right'), bottom: px('--inset-bottom'), left: px('--inset-left') }
  }

  // A desktop menu opens at the pointer and is flipped back inside the
  // window when it would run off an edge. A phone's callout goes above the
  // finger, so what is under the finger stays in view, and below it only when
  // there is no room above; either way it is kept inside the visual viewport
  // - the part of the screen the keyboard has not covered - and clear of the
  // notch. The sheet needs no placing: it is the bottom of the screen.
  $effect(() => {
    if (!menu.open || !element || sheet) return

    const { width, height } = element.getBoundingClientRect()

    if (!callout) {
      above = false
      position = {
        x: Math.min(menu.x, window.innerWidth - width - 8),
        y: Math.min(menu.y, window.innerHeight - height - 8),
      }
      return
    }

    // The layout size, not the drawn one: the menu is still growing out of
    // its corner when this runs, and a box measured mid-transition is 4%
    // short, which is enough to leave the callout past the edge.
    const { offsetWidth: full, offsetHeight: tall } = element
    const seen = window.visualViewport
    const inset = insets(element)
    const left = (seen?.offsetLeft ?? 0) + inset.left + 8
    const right = (seen ? seen.offsetLeft + seen.width : window.innerWidth) - inset.right - 8
    const top = (seen?.offsetTop ?? 0) + inset.top + 8
    const bottom = (seen ? seen.offsetTop + seen.height : window.innerHeight) - inset.bottom - 8

    // Room for the finger itself, so the first row is not under it.
    const clear = 16
    above = menu.y - clear - tall >= top
    position = {
      x: Math.max(left, Math.min(menu.x - full / 2, right - full)),
      y: above ? menu.y - clear - tall : Math.min(menu.y + clear, bottom - tall),
    }
  })

  // The keyboard coming or going, or the page shifting under a pinch, moves
  // the ground a phone's menu was placed on; it goes rather than floats.
  $effect(() => {
    const seen = window.visualViewport
    if (!menu.open || !viewport.phone || !seen) return

    const hide = () => menu.hide()
    seen.addEventListener('resize', hide)
    seen.addEventListener('scroll', hide)

    return () => {
      seen.removeEventListener('resize', hide)
      seen.removeEventListener('scroll', hide)
    }
  })

  /** Rises from the bottom as a sheet; grows out of its corner as a popover,
   *  which is the same motion on a desktop and in a callout. */
  function arrive(node: Element) {
    if (sheet) return fly(node, { y: 40, duration: 220, easing: cubicOut })
    return scale(node, { duration: 120, start: 0.96, easing: cubicOut })
  }

  function choose(item: MenuItem) {
    menu.hide()
    item.run()
  }
</script>

<svelte:window
  onclick={() => menu.hide()}
  onblur={() => menu.hide()}
  onresize={() => menu.hide()}
  onkeydown={(event) => event.key === 'Escape' && menu.hide()}
/>

{#if menu.open}
  {#if viewport.phone}
    <!-- Takes the tap that closes the menu, and the scroll that would
         otherwise reach the list under it. Dimmed under a sheet, which is a
         layer over the app; clear under a callout, which sits beside a
         selection that has to stay readable. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="scrim" class:dim={sheet} transition:fade={{ duration: 130 }} onclick={() => menu.hide()}></div>
  {/if}

  <div
    bind:this={element}
    class="menu"
    class:touch={viewport.phone}
    class:sheet
    class:above
    style:left={sheet ? undefined : `${position.x}px`}
    style:top={sheet ? undefined : `${position.y}px`}
    style:--keyboard={sheet ? `${viewport.keyboard}px` : undefined}
    transition:arrive
    role="menu"
    tabindex="-1"
  >
    {#if sheet}
      <div class="grip" aria-hidden="true"></div>
      <!-- A sheet does not point at anything the way a popover does, so it
           says what it is about. -->
      {#if menu.title}<p class="title">{menu.title}</p>{/if}
    {/if}

    <div class="rows">
      {#each entries as item, index (index)}
        {#if item === null}
          <hr />
        {:else}
          <button
            role="menuitem"
            class:danger={item.danger}
            disabled={item.disabled}
            onclick={() => choose(item)}
          >
            <span>{item.label}</span>
            <!-- A shortcut means nothing to a thumb. -->
            {#if item.hint && !viewport.phone}<kbd>{item.hint}</kbd>{/if}
          </button>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 60;
    min-width: 11rem;
    padding: var(--space-1);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    transform-origin: top left;
    /* Copied here for the script, which places the callout. */
    --inset-top: env(safe-area-inset-top, 0px);
    --inset-right: env(safe-area-inset-right, 0px);
    --inset-bottom: env(safe-area-inset-bottom, 0px);
    --inset-left: env(safe-area-inset-left, 0px);
  }

  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 6px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  button.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }

  button:disabled {
    color: var(--muted);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  hr {
    margin: var(--space-1) 4px;
    border: none;
    border-top: 1px solid var(--line);
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    /* A finger on it neither scrolls nor pinches what is underneath. */
    touch-action: none;
  }

  .scrim.dim {
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  .touch {
    z-index: 61;
  }

  /* A whole line for a thumb, and the danger in its colour all the time,
     since there is no hover to bring it out. */
  .touch button {
    min-height: 44px;
    padding: 0 14px;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    font-size: 15px;
  }

  .touch button:hover:not(:disabled) {
    background: none;
    color: var(--text);
  }

  .touch button:active:not(:disabled) {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .touch button.danger:not(:disabled) {
    color: var(--danger);
  }

  .touch button.danger:active:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }

  .touch hr {
    margin: 6px 12px;
  }

  /* The callout: still a popover, grown from the side the finger is on. */
  .touch:not(.sheet) {
    min-width: 12rem;
    max-width: calc(100vw - 16px);
    transform-origin: top center;
  }

  .touch.above {
    transform-origin: bottom center;
  }

  /* The sheet: the full width, anchored to the bottom - or to the top of
     the keyboard, on a phone that keeps its layout under one - and never
     the whole screen, so what it is about stays in view above it. */
  .sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: var(--keyboard, 0px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    max-height: min(72dvh, calc(100dvh - var(--keyboard, 0px) - var(--space-5)));
    padding: 0 0 env(safe-area-inset-bottom);
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
    padding: 10px 20px 4px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The rows scroll inside the sheet when there are more than fit, and the
     scroll stops at their end rather than reaching the page. */
  .sheet .rows {
    flex: 1;
    min-height: 0;
    padding: 6px max(8px, env(safe-area-inset-right)) 8px max(8px, env(safe-area-inset-left));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
