<script lang="ts">
  import { t } from '../i18n.svelte'
  import { type Family, installedFamilies, isInstalled, offered } from '../font-families'
  import { overlays } from '../overlays'
  import { hang } from '../portal'

  const {
    value,
    placeholder,
    mono,
    label,
    onchange,
  }: {
    value: string
    placeholder: string
    mono: boolean
    label: string
    onchange: (family: string) => void
  } = $props()

  const id = $props.id()

  let host = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()
  let list = $state<HTMLElement>()
  let typed = $state<string | null>(null)
  let open = $state(false)
  let active = $state(-1)
  let families = $state<Family[]>([])

  const MOST = 200

  const shown = $derived(offered(families, typed ?? '', mono).slice(0, MOST))
  const missing = $derived(value !== '' && !isInstalled(value))

  $effect(() =>
    open ? overlays.show(close, () => [host, list].filter((one) => one !== undefined)) : undefined,
  )

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

<span class="picker orden-setting-value" bind:this={host}>
  <input
    bind:this={field}
    class="orden-field is-value"
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
      if (typed !== null) choose(event.currentTarget.value)
      else close()
    }}
    onkeydown={keyed}
  />

  {#if open && shown.length}
    <ul
      id={`${id}-list`}
      class="orden-layer list"
      role="listbox"
      aria-label={label}
      bind:this={list}
      use:hang={{ side: 'below', gap: 4, from: host ?? null, stretch: true }}
    >
      {#each shown as one, at (one.name)}
        <li
          id={`${id}-${at}`}
          role="option"
          aria-selected={one.name === value}
          class:cursor={at === active}
          style:font-family={`"${one.name}", var(--font-ui)`}
          onpointerdown={(event) => {
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
  }

  .list {
    max-height: 280px;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    overflow-y: auto;
    z-index: var(--z-menu);
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

  .missing {
    flex-basis: 100%;
    color: var(--danger);
    font-size: var(--text-xs);
    text-align: end;
  }
</style>
