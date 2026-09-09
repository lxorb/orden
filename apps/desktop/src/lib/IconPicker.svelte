<script lang="ts">
  /** The one picker in the app, for everything that can wear an icon: a space in
   *  the rail, and a note in the file list. What is being chosen for is in
   *  icon-choice.svelte.ts rather than in a prop, because a note's row is drawn
   *  deep inside a tree of these components and a space's is somewhere else
   *  entirely; this is mounted once, over the whole page.
   *
   *  Which leaves one difference between the two, and it is where the icon is
   *  kept: a space's belongs to this device, a note's belongs to the note and is
   *  written into its front matter. Hence the last row, which says what the thing
   *  falls back to when it wears nothing - a letter for a space, and for a note
   *  the mark that says what kind of file it is. */
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { iconChoice } from './icon-choice.svelte'
  import { type IconNode, keyNamed, loadIcons, readIcon, search } from './icons'
  import { links } from './link-index.svelte'
  import { setNoteIcon } from './note-icon'
  import { workspace } from './workspace.svelte'
  import { dur } from './motion'
  import { trap } from './trap'

  let query = $state('')
  let library = $state<Record<string, IconNode>>({})
  let field = $state<HTMLInputElement>()

  const target = $derived(iconChoice.target)
  const names = $derived(Object.keys(library))
  const shown = $derived(search(names, query))

  /** Which icon the thing being chosen for wears now, as a name in the library,
   *  so the one it already has is the one shown as chosen. A note that wears an
   *  emoji has no name in the library, and nothing in the grid is its. */
  const chosen = $derived.by(() => {
    if (!target) return null
    if (target.kind === 'space') return workspace.iconFor(target.id)

    const written = readIcon(links.iconOf(target.path))
    return written?.kind === 'lucide' ? keyNamed(library, written.name) : null
  })

  /** How long the field waits for the sheet's own transition before it takes the
   *  keyboard. Focusing an element that is still scaling up scrolls the sheet. */
  const FOCUS = 40

  /** Which opening this is, so a set of icons that arrives after the sheet has
   *  been closed - or opened again on something else - is not the set shown. */
  let opening = 0
  let focusing: ReturnType<typeof setTimeout> | undefined

  async function fill() {
    const mine = ++opening
    query = ''

    const all = await loadIcons()
    if (mine !== opening) return

    library = all
    clearTimeout(focusing)
    // Waiting on a transition that is not happening is waiting for nothing.
    focusing = setTimeout(() => field?.focus(), dur(FOCUS))
  }

  // The sheet is up the moment somebody asks for it; the set of icons is a
  // chunk of its own and arrives after.
  $effect(() => {
    if (iconChoice.target) void fill()
  })

  function pick(name: string | null) {
    const asked = iconChoice.target
    if (!asked) return

    if (asked.kind === 'space') workspace.setIcon(asked.id, name)
    else void setNoteIcon(asked.path, name)

    iconChoice.close()
  }

  // Nothing is waiting to be focused once the sheet has gone.
  $effect(() => () => clearTimeout(focusing))

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (target ? overlays.show(() => iconChoice.close()) : undefined))
  $effect(() => closeOnBack(target !== null, () => iconChoice.close()))
</script>

{#if target}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="scrim"
    transition:fade={{ duration: dur(130) }}
    onclick={() => iconChoice.close()}
  ></div>

  <div
    class="sheet"
    use:trap
    transition:scale={{ duration: dur(190), start: 0.97, easing: cubicOut }}
  >
    <input
      bind:this={field}
      bind:value={query}
      placeholder={t('Search icons - work, journal, money…')}
      spellcheck="false"
    />

    {#if !names.length}
      <p class="empty">{t('Loading…')}</p>
    {:else if !shown.length}
      <p class="empty">{t('Nothing found')}</p>
    {:else}
      <div class="grid">
        {#each shown as name (name)}
          <button
            title={name}
            aria-label={name}
            class:active={chosen === name}
            onclick={() => pick(name)}
          >
            <svg viewBox="0 0 24 24">
              {#each library[name] as [tag, attrs] (JSON.stringify(attrs))}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
        {/each}
      </div>
    {/if}

    <button class="clear" onclick={() => pick(null)}>
      {target.kind === 'note' ? t('Use the plain mark instead') : t('Use the first letter instead')}
    </button>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 50;
  }

  .sheet {
    position: fixed;
    top: 14vh;
    left: 50%;
    translate: -50% 0;
    width: min(30rem, calc(100vw - 3rem));
    z-index: 51;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
    gap: 4px;
    max-height: 46vh;
    overflow-y: auto;
  }

  .grid button {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  .grid button:hover {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .grid button.active {
    background: var(--accent);
    color: #fff;
  }

  .grid svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .empty {
    margin: 0;
    padding: var(--space-5) 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .clear {
    align-self: flex-start;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .clear:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }
</style>
