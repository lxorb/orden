<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { appCommands, type Command } from './commands'
  import { t } from './i18n.svelte'
  import { rank } from './fuzzy'
  import { shownName } from './note-name'
  import { overlays } from './overlays'
  import { workspace, type Entry } from './workspace.svelte'
  import { dur } from './motion'

  // eslint-disable-next-line prefer-const -- `open` is bindable, and a $props() pattern cannot be split
  let { open = $bindable(false), view }: { open?: boolean; view?: EditorView | undefined } =
    $props()

  let query = $state('')
  let cursor = $state(0)
  let input = $state<HTMLInputElement>()

  const asCommands = $derived(query.startsWith('>'))
  const term = $derived(asCommands ? query.slice(1).trim() : query.trim())

  /** Every command there is, built while the palette is open and not once per
   *  keystroke: the list asks what the document goes out as, and answering that
   *  walks every line of it. What a row says still follows the app - the labels
   *  read the stores, so this rebuilds when one of them changes - but typing
   *  changes none of them. */
  const commands = $derived(open ? appCommands(view) : [])

  const results = $derived.by((): (Command | Entry)[] => {
    if (asCommands) return rank(term, commands, (command) => command.label)
    return rank(term, workspace.files, (one) => shownName(one.name)).slice(0, 40)
  })

  const label = (item: Command | Entry) => ('label' in item ? item.label : shownName(item.name))

  /** Reads a value for its own sake, so the effect around it follows that
   *  value. Nothing wants the value itself. */
  const follows = (_value: unknown) => undefined

  // A fresh set of results starts at the top: the row the cursor pointed at is
  // no longer the one under it.
  $effect(() => {
    follows(results)
    cursor = 0
  })

  $effect(() => {
    if (open) input?.focus()
  })

  function choose(item: Command | Entry) {
    if ('run' in item) {
      if (item.disabled) return
      item.run()
    } else void workspace.openEntry(item.path)

    open = false
    query = ''
  }

  /** Closed, and forgotten: the next opening starts on an empty field rather
   *  than on whatever was typed last time. */
  function dismiss() {
    open = false
    query = ''
  }

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (open ? overlays.show(dismiss) : undefined))

  /** A keystroke this list has answered goes no further. The app reads its own
   *  keys off the window, and Ctrl+N there is New note: without this, stepping
   *  down the list with Ctrl+N opens a blank note behind the palette. */
  function spend(event: KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      spend(event)
      cursor = (cursor + 1) % Math.max(results.length, 1)
      return
    }

    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      spend(event)
      cursor = (cursor - 1 + results.length) % Math.max(results.length, 1)
      return
    }

    const chosen = results[cursor]
    if (event.key === 'Enter' && chosen) {
      spend(event)
      choose(chosen)
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <!-- Tapping away is the same answer as Escape, so it forgets the same. -->
  <div class="scrim" transition:fade={{ duration: dur(130) }} onclick={dismiss}></div>

  <div class="palette" transition:scale={{ duration: dur(190), start: 0.97, easing: cubicOut }}>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onKeydown}
      placeholder={t('Go to note, or > for commands')}
      spellcheck="false"
      aria-label={t('Search notes and commands')}
    />

    {#if results.length}
      <ul>
        {#each results as item, index (`${label(item)}:${index}`)}
          <li>
            <button
              class="nib-row"
              class:is-on={index === cursor}
              class:dim={'disabled' in item && item.disabled}
              onmouseenter={() => (cursor = index)}
              onclick={() => choose(item)}
            >
              <!-- The same tick the menu rows carry, in a slot every command row
                   keeps whether or not there is one in it, so the words line up.
                   The notes have nothing to tick and so have no slot; see
                   AppMenu.svelte. -->
              {#if asCommands}
                <span class="tick">{'checked' in item && item.checked ? '✓' : ''}</span>
              {/if}
              <span class="nib-row-label">{label(item)}</span>
              {#if 'hint' in item && item.hint}<kbd>{item.hint}</kbd>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <!-- Typed into and nothing answered. The same words the find sheet says,
           since it is the same question; see PromptSheet.svelte. -->
    {:else if term}
      <p class="nothing">{t('Nothing found')}</p>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 20;
  }

  .palette {
    position: fixed;
    top: 16vh;
    left: 50%;
    translate: -50% 0;
    width: min(34rem, calc(100vw - 3rem));
    z-index: 21;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  input {
    width: 100%;
    padding: var(--space-4);
    border: none;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    outline: none;
  }

  input::placeholder {
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    max-height: 46vh;
    overflow-y: auto;
  }

  /* The rows are `.nib-row`, the same row the file list is made of - the one the
     arrow keys walk carries the same fill an open note does. */
  button.dim {
    opacity: 0.45;
  }

  /* The width is held whether or not there is a tick in it, so the labels line
     up down the list. The same shape the menu rows use. */
  .tick {
    width: 0.9em;
    flex: none;
    color: var(--accent);
  }

  kbd {
    flex: none;
  }

  .nothing {
    margin: 0;
    padding: var(--space-4);
    color: var(--muted);
    font-size: var(--text-row);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  :global([data-touch]) .palette {
    top: 0;
    left: 0;
    translate: none;
    width: 100%;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    padding-top: var(--inset-top);
  }

  /* The rows are a list like any other and take the row scale with every other
     list; the field over them is the one thing here that does not. */
  :global([data-touch]) input {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  /* Room for more of them, now that each is taller, and the last one clears the
     gesture bar. */
  :global([data-touch]) ul {
    max-height: 60dvh;
    padding-bottom: var(--touch-bottom);
  }
</style>
