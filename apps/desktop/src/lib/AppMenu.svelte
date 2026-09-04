<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { appMenu, type MenuGroup, SPLIT } from './app-menu'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'

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
  <div class="scrim" onclick={() => (open = false)}></div>

  <div class="menu" transition:fly={{ x: -8, duration: 160, easing: cubicOut }}>
    <!-- The groups on the left, whatever is chosen on the right, the way a
         menu bar reads once it has nowhere along the top to live. -->
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

  .hamburger:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .hamburger svg {
    width: 15px;
    height: 15px;
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

  /* On a phone the drawer is already the width of the screen, so the menu
     takes it over rather than sitting beside a rail that is not there. */
  @media (max-width: 720px) {
    .hamburger {
      width: 48px;
      height: 48px;
    }

    .menu {
      top: auto;
      left: max(var(--space-2), env(safe-area-inset-left));
      right: max(var(--space-2), env(safe-area-inset-right));
      bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
      max-height: 70vh;
    }

    .groups {
      width: 7.5rem;
    }

    button {
      min-height: 44px;
    }
  }
</style>
