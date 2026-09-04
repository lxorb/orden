<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { appMenu, type MenuGroup, SPLIT } from './app-menu'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { viewport } from './viewport.svelte'

  let {
    view,
    onpalette,
    onhistory,
  }: { view?: EditorView; onpalette: () => void; onhistory: () => void } = $props()

  let open = $state(false)
  let groups = $state<MenuGroup[]>([])
  let current = $state('file')

  function show() {
    // Built on opening, so what is ticked and what is greyed out describes now.
    groups = appMenu({ view, onpalette, onhistory })
    current = groups[0]?.id ?? 'file'
    open = true
  }

  const shown = $derived(groups.find((one) => one.id === current))

  /** A popover that grows out of the button on a desktop; a sheet from the
   *  bottom on a phone, where the thumb is. */
  function arrive(node: Element) {
    if (viewport.phone) return fly(node, { y: 40, duration: 220, easing: cubicOut })

    return {
      duration: 220,
      easing: cubicOut,
      css: (t: number) =>
        `opacity: ${t}; transform: translate(${(t - 1) * 6}px, ${(t - 1) * 6}px) scale(${0.96 + 0.04 * t}); transform-origin: top left`,
    }
  }

  $effect(() => closeOnBack(open, () => (open = false)))
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && open) open = false
  }}
/>

<button
  class="hamburger"
  title={t('Menu')}
  aria-label={t('Menu')}
  aria-expanded={open}
  onclick={() => (open ? (open = false) : show())}
>
  <svg viewBox="0 0 16 16"><path d="M1.5 4h13M1.5 8h13M1.5 12h13" /></svg>
</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 130 }} onclick={() => (open = false)}></div>

  <div class="menu" class:phone={viewport.phone} transition:arrive>
    {#if viewport.phone}
      <div class="grip" aria-hidden="true"></div>
    {/if}

    <!-- The groups on the left, whatever is chosen on the right, the way a
         menu bar reads once it has nowhere along the top to live. On a phone
         the groups are a row of chips instead, above the rows. -->
    <ul class="groups">
      {#each groups as group (group.id)}
        <li>
          <button
            class:on={group.id === current}
            onmouseenter={() => (current = group.id)}
            onclick={() => (current = group.id)}
          >
            {group.label}
          </button>
        </li>
      {/each}
    </ul>

    <ul class="rows">
      {#each shown?.rows ?? [] as row, index (index)}
        {#if row === SPLIT}
          <li class="split"></li>
        {:else}
          <li>
            <button
              class="row"
              disabled={row.disabled}
              onclick={() => {
                open = false
                row.run()
              }}
            >
              <!-- Present only when it means something; the width is held by
                   CSS so the labels still line up. -->
              <span class="tick">{row.checked ? '✓' : ''}</span>
              <span class="label">{row.label}</span>
              {#if row.hint}<span class="hint">{row.hint}</span>{/if}
            </button>
          </li>
        {/if}
      {/each}
    </ul>
  </div>
{/if}

<style>
  .hamburger {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    /* The rule for the menu rows below reaches every button in this component,
       this one included. Its padding left a 10px box for a 15px icon, which
       pushed the icon off the button's centre. */
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .hamburger:hover {
      background: var(--surface-2);
      color: var(--text-strong);
    }
  }

  .hamburger svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 44;
  }

  .menu {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-2));
    left: calc(var(--rail-width) + var(--space-2));
    z-index: 45;
    display: flex;
    max-height: 78vh;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
  }

  .groups {
    flex: none;
    width: 8.5rem;
    border-right: 1px solid var(--line);
  }

  .rows {
    min-width: 15rem;
  }

  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 7px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
  }

  button:hover:not(:disabled),
  .groups button.on {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  button:disabled {
    color: var(--muted);
  }

  .tick {
    width: 0.9em;
    flex: none;
    color: var(--accent);
  }

  .label {
    flex: 1;
  }

  .hint {
    flex: none;
    color: var(--muted);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .split {
    height: 1px;
    margin: var(--space-2) 6px;
    background: var(--line);
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  @media (max-width: 720px) {
    .hamburger {
      width: 48px;
      height: 48px;
    }

    .hamburger svg {
      width: 22px;
      height: 22px;
    }

    /* Dimmed here, where the sheet is a layer over the app rather than a
       popover beside a button. */
    .scrim {
      background: color-mix(in srgb, var(--bg) 55%, transparent);
      backdrop-filter: blur(2px);
    }

    /* Anchored to the bottom, the full width, and tall enough for the longest
       group without ever covering the whole screen. */
    .menu.phone {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      flex-direction: column;
      max-height: 72dvh;
      padding-bottom: env(safe-area-inset-bottom);
      border: none;
      border-top: 1px solid var(--line-strong);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      background: var(--surface);
    }

    .grip {
      flex: none;
      width: 36px;
      height: 4px;
      margin: 8px auto 2px;
      border-radius: 2px;
      background: var(--line-strong);
    }

    /* The groups as chips that wrap, so all of them are in view at once
       rather than some of them off the edge of a strip. */
    .phone .groups {
      flex: none;
      width: auto;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 14px 10px;
      border-right: none;
      border-bottom: 1px solid var(--line);
      overflow: visible;
    }

    .phone .groups button {
      width: auto;
      min-height: 36px;
      padding: 6px 14px;
      border-radius: 99px;
      background: var(--surface-2);
      color: var(--muted-strong);
      font-size: 14px;
      font-weight: 500;
    }

    .phone .groups button.on {
      background: var(--accent-soft);
      color: var(--accent);
    }

    .phone .rows {
      flex: 1;
      min-width: 0;
      min-height: 0;
      padding: 6px 8px 8px;
      overflow-y: auto;
    }

    .phone .row {
      min-height: 48px;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      font-size: 15px;
    }

    .phone .row:active:not(:disabled) {
      background: var(--surface-2);
    }

    /* Hover has no meaning under a finger; the lit row would just stick. */
    .phone .row:hover:not(:disabled) {
      background: none;
      color: var(--text);
    }

    /* The tick at the trailing edge, where a phone puts what is on, and no
       room held for it where there is none. */
    .phone .tick {
      order: 2;
      width: auto;
      margin-left: auto;
    }

    .phone .hint {
      display: none;
    }

    .phone .split {
      margin: 6px 12px;
    }
  }
</style>
