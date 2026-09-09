<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { appMenu, isSubmenu, type MenuGroup, type MenuRow, SPLIT } from './app-menu'
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { t } from './i18n.svelte'
  import { viewport } from './viewport.svelte'
  import { dur } from './motion'

  const {
    view,
    onpalette,
    onhistory,
  }: { view?: EditorView | undefined; onpalette: () => void; onhistory: () => void } = $props()

  let open = $state(false)
  let groups = $state<MenuGroup[]>([])
  let current = $state('file')
  /** The submenu that is open, by its label. One at a time, and only ever one
   *  level deep: a menu that goes deeper than that is a menu nobody can hold in
   *  their head. */
  let into = $state<string | null>(null)

  function show() {
    // Built on opening, so what is ticked and what is greyed out describes now.
    groups = appMenu({ view, onpalette, onhistory })
    current = groups[0]?.id ?? 'file'
    into = null
    open = true
  }

  function choose(id: string) {
    current = id
    into = null
  }

  const shown = $derived(groups.find((one) => one.id === current))

  /** Whichever list is in front: the group's own rows, or the rows of the
   *  submenu somebody stepped into. */
  const rows = $derived.by((): MenuRow[] => {
    const all = shown?.rows ?? []
    if (into === null) return all

    const found = all.find((row) => isSubmenu(row) && row.label === into)
    return found && isSubmenu(found) ? found.rows : all
  })

  /** A popover that grows out of the button on a desktop; a sheet from the
   *  bottom on a phone, where the thumb is. */
  function arrive(node: Element) {
    if (viewport.touch) return fly(node, { y: 40, duration: dur(220), easing: cubicOut })

    return {
      duration: dur(220),
      easing: cubicOut,
      css: (t: number) =>
        `opacity: ${t}; transform: translate(${(t - 1) * 6}px, ${(t - 1) * 6}px) scale(${0.96 + 0.04 * t}); transform-origin: top left`,
    }
  }

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))
  $effect(() => closeOnBack(open, () => (open = false)))
</script>

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
  <div class="scrim" transition:fade={{ duration: dur(130) }} onclick={() => (open = false)}></div>

  <div class="menu" class:phone={viewport.touch} transition:arrive>
    {#if viewport.touch}
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
            onmouseenter={() => choose(group.id)}
            onclick={() => choose(group.id)}
          >
            {group.label}
          </button>
        </li>
      {/each}
    </ul>

    <ul class="rows">
      <!-- Inside a submenu the list is its rows, headed by the way back. The
           same shape on a desktop and under a thumb: one list, one step in, one
           step out, and nothing that has to be aimed at. -->
      {#if into !== null}
        <li>
          <button class="row back" onclick={() => (into = null)}>
            <span class="tick" aria-hidden="true">
              <svg viewBox="0 0 12 12"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
            </span>
            <span class="label">{into}</span>
          </button>
        </li>
        <li class="split"></li>
      {/if}

      {#each rows as row, index (index)}
        <!-- Named apart so each branch has the shape it draws: the markup cannot
             read a type guard's other half. -->
        {@const leads = row !== SPLIT && isSubmenu(row) ? row : null}
        {@const action = row !== SPLIT && !isSubmenu(row) ? row : null}

        {#if leads}
          <li>
            <button class="row" disabled={leads.disabled} onclick={() => (into = leads.label)}>
              <span class="tick"></span>
              <span class="label">{leads.label}</span>
              <span class="more" aria-hidden="true">
                <svg viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
              </span>
            </button>
          </li>
        {:else if action}
          <li>
            <button
              class="row"
              disabled={action.disabled}
              onclick={() => {
                open = false
                action.run()
              }}
            >
              <!-- Present only when it means something; the width is held by
                   CSS so the labels still line up. -->
              <span class="tick">{action.checked ? '✓' : ''}</span>
              <span class="label">{action.label}</span>
              {#if action.hint}<span class="hint">{action.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="split"></li>
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

  .groups button:active:not(:disabled) {
    background: var(--press);
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

  /* The chevron that says a row leads somewhere, and the one on the way back.
     Muted: it is a shape, not something to read. */
  .more,
  .back .tick {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  .more svg,
  .back .tick svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .back .label {
    color: var(--muted-strong);
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
  /* Square with the spaces below it in the rail, so the column reads as one
     stack rather than a button and then a list. */
  :global([data-touch]) .hamburger {
    width: var(--touch-row);
    height: var(--touch-row);
  }

  :global([data-touch]) .hamburger svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }

  /* Dimmed here, where the sheet is a layer over the app rather than a
     popover beside a button. */
  :global([data-touch]) .scrim {
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  /* Anchored to the bottom, the full width, and tall enough for the longest
     group without ever covering the whole screen. */
  :global([data-touch]) .menu.phone {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    flex-direction: column;
    max-height: 72dvh;
    padding-bottom: var(--touch-bottom);
    border: none;
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
  }

  :global([data-touch]) .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }

  /* The groups as chips that wrap, so all of them are in view at once
     rather than some of them off the edge of a strip. */
  :global([data-touch]) .phone .groups {
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

  :global([data-touch]) .phone .groups button {
    width: auto;
    min-height: var(--touch-target);
    padding: 0 var(--touch-pad);
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--muted-strong);
    font-size: var(--text-base);
    font-weight: 500;
  }

  :global([data-touch]) .phone .groups button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  :global([data-touch]) .phone .rows {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 6px var(--space-2) var(--space-2);
    overflow-y: auto;
  }

  :global([data-touch]) .phone .row {
    min-height: var(--touch-row);
    gap: var(--touch-gap);
    padding: 0 var(--touch-pad);
    border-radius: var(--radius-md);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .phone .row:active:not(:disabled) {
    background: var(--surface-2);
  }

  /* Hover has no meaning under a finger; the lit row would just stick. */
  :global([data-touch]) .phone .row:hover:not(:disabled) {
    background: none;
    color: var(--text);
  }

  /* The tick at the trailing edge, where a phone puts what is on, and no
     room held for it where there is none. */
  :global([data-touch]) .phone .tick {
    order: 2;
    width: auto;
    margin-left: auto;
  }

  /* The way back keeps its chevron in front of the words, where a back button
     belongs whatever the machine. */
  :global([data-touch]) .phone .back .tick {
    order: 0;
    width: 0.9em;
    margin-left: 0;
  }

  :global([data-touch]) .phone .hint {
    display: none;
  }

  :global([data-touch]) .phone .split {
    margin: 6px 12px;
  }
</style>
