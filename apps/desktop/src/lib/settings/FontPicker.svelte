<script lang="ts">
  /** A face chosen from what is installed, or typed by its name (#772).
   *
   *  A field and a list under it, Chrome's font settings and a combobox in one: typing
   *  narrows the list, the arrows walk it, Enter or a press takes a row, Escape puts it
   *  away. Each row is set in its own face, which is how a reader looking for a face
   *  tells one from another; a face for code lists the monospaced ones first. A name
   *  nothing on this machine draws is said to be so under the row, rather than drawn in
   *  the app's own face without a word. See font-families.ts. */

  import { t } from '../i18n.svelte'
  import { type Family, installedFamilies, isInstalled, offered } from '../font-families'
  import { overlays } from '../overlays'

  const {
    value,
    placeholder,
    mono,
    label,
    onchange,
  }: {
    value: string
    /** The app's own face, which an empty field is. */
    placeholder: string
    /** Whether the face is for code, which lists the monospaced families first. */
    mono: boolean
    label: string
    onchange: (family: string) => void
  } = $props()

  const id = $props.id()

  let host = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()
  let typed = $state<string | null>(null)
  let open = $state(false)
  let active = $state(-1)
  let families = $state<Family[]>([])

  /** At most this many rows: a machine with three thousand faces is a list nobody reads
   *  to the end, and what is typed narrows it to what they meant. */
  const MOST = 200

  const shown = $derived(offered(families, typed ?? '', mono).slice(0, MOST))
  const missing = $derived(value !== '' && !isInstalled(value))

  $effect(() => (open ? overlays.show(close, () => (host ? [host] : [])) : undefined))

  function show() {
    open = true
    active = -1
    void installedFamilies().then((found) => (families = found))
  }

  function close() {
    open = false
    typed = null
  }

  function choose(family: string) {
    onchange(family.trim())
    if (field) field.value = family.trim()
    close()
  }

  function keyed(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) show()
      const step = event.key === 'ArrowDown' ? 1 : -1
      active = Math.max(-1, Math.min(shown.length - 1, active + step))
      document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(active >= 0 ? (shown[active]?.name ?? '') : (field?.value ?? ''))
      return
    }
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      if (field) field.value = value
      close()
    }
  }
</script>

<span class="picker" bind:this={host}>
  <input
    bind:this={field}
    class="inline"
    type="text"
    role="combobox"
    aria-expanded={open}
    aria-controls={`${id}-list`}
    aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
    aria-label={label}
    aria-invalid={missing || undefined}
    {value}
    {placeholder}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
    style:font-family={value ? `"${value}", var(--font-ui)` : undefined}
    onfocus={show}
    oninput={(event) => {
      typed = event.currentTarget.value
      active = -1
      if (!open) show()
    }}
    onblur={(event) => {
      // Left with something typed: that is the face, picked from the list or not.
      if (typed !== null) choose(event.currentTarget.value)
      else close()
    }}
    onkeydown={keyed}
  />

  {#if open && shown.length}
    <ul id={`${id}-list`} class="nib-layer list" role="listbox" aria-label={label}>
      {#each shown as one, at (one.name)}
        <li
          id={`${id}-${at}`}
          role="option"
          aria-selected={one.name === value}
          class:cursor={at === active}
          style:font-family={`"${one.name}", var(--font-ui)`}
          onpointerdown={(event) => {
            // Taken on the press, before the field hears that it lost the keyboard.
            event.preventDefault()
            choose(one.name)
          }}
          onpointerenter={() => (active = at)}
        >
          {one.name}
        </li>
      {/each}
    </ul>
  {/if}
</span>

{#if missing}
  <small class="missing">{t('Not installed on this device, so the app’s own face is used.')}</small>
{/if}

<style>
  .picker {
    position: relative;
    flex: none;
  }

  /* The settings' own field, written out because this is a component of its own. */
  .inline {
    width: 12rem;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: end;
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .inline::placeholder {
    color: var(--muted);
  }

  .inline[aria-invalid='true'] {
    border-color: var(--danger);
  }

  @media (hover: hover) {
    .inline:hover {
      border-color: var(--line);
    }
  }

  .inline:focus {
    background: var(--bg);
    text-align: start;
  }

  .list {
    position: absolute;
    top: calc(100% + var(--space-1));
    inset-inline-end: 0;
    width: 16rem;
    max-height: 280px;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    overflow-y: auto;
    z-index: var(--z-popover);
  }

  .list li {
    min-height: 30px;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: var(--text-base);
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }

  .list li.cursor {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  /* Under the row, across it, in the colour the app says no in. */
  .missing {
    flex-basis: 100%;
    color: var(--danger);
    font-size: var(--text-xs);
    text-align: end;
  }
</style>
