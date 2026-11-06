<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { fade, fly, scale, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@orden/editor'
  import Swatches from './Swatches.svelte'
  import { account } from './account.svelte'
  import { exportCommands } from './commands'
  import { arrive, segmented } from './slide'
  import CanvasIcon from './CanvasIcon.svelte'
  import DefaultBrowser from './settings/DefaultBrowser.svelte'
  import FontPicker from './settings/FontPicker.svelte'
  import BrowserThemes from './settings/BrowserThemes.svelte'
  import ExtensionRows from './settings/ExtensionRows.svelte'
  import { enginesFor } from './web-tab/engines'
  import { CUSTOM, searchEngine } from './web-tab/search-engine.svelte'
  import Hint from './Hint.svelte'
  import Outward from './Outward.svelte'
  import Icon from './Icon.svelte'
  import { i18n, message, plural, t } from './i18n.svelte'
  import AiPane from './AiPane.svelte'
  import { SEARCH_MARK } from './panel-marks'
  import Security from './Security.svelte'
  import SyncPane from './SyncPane.svelte'
  import RecentlyDeleted from './RecentlyDeleted.svelte'
  import { scrollbar } from './scrollbar'
  import Select from './Select.svelte'
  import { settings, type Section } from './settings.svelte'
  import { CATEGORIES, SHORTCUTS, shortcuts } from './shortcuts.svelte'
  import './views/task-keys'
  import { runnable } from './shortcuts/registry'
  import { glyphFor, lowMark, markFor, nameFor, toolbar } from './toolbar.svelte'
  import { NOTHING, pull } from './pull.svelte'
  import { PRESETS, presetById } from './shortcuts/presets'
  import { showCombination } from './keys'
  import { prompt } from './prompt.svelte'
  import { Rebind } from './settings/rebind.svelte'
  import { globalKeys, noteFor } from './global-keys.svelte'
  import { hearTaps } from './tapped'
  import { landing } from './settings/landing.svelte'
  import { places as paneRows } from './settings/places'
  import { ICONS, sectionGroups } from './settings/sections'
  import { type Place, search } from './settings-search'
  import { sync } from './sync.svelte'
  import { isDesktop, openExternal } from './tauri'
  import { runsExtensions } from './web-tab/extensions.svelte'
  import { theme } from './theme.svelte'
  import ThemeStore from './ThemeStore.svelte'
  import { store } from './themes/store.svelte'
  import { type Field, type PictureSide, preferences, resetPane, resettable } from './preferences'
  import { declared, shortcutKey } from './settings/declared.svelte'
  import { glassesKey } from './even/key.svelte'
  import { EFFORT_WORDS, Offered } from './even/offered.svelte'
  import { modes } from './modes.svelte'
  import { readableSize, usage } from './usage.svelte'
  import { pageHeight, viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'
  import { dur } from './motion'
  import { waited } from './timing'
  import { trap } from './trap'
  import Cross from './Cross.svelte'

  const { view }: { view?: EditorView | undefined } = $props()

  const offered = new Offered()

  let replacingKey = $state(false)
  let customising = $state(false)
  let customBad = $state(false)

  let leaving = $state(false)

  const LIT = 1400

  const GROUPS = $derived(sectionGroups())

  const SECTIONS = $derived(GROUPS.flat())
  const titleOf = (id: Section) => SECTIONS.find((one) => one.id === id)?.label ?? ''

  let query = $state('')
  let accessDetail = $state(false)

  const panes = $derived(preferences(view))
  const current = $derived(panes.find((one) => one.id === settings.section))

  const exportActions = () =>
    exportCommands().filter((command) => command.id !== 'page-setup' && command.id !== 'import')

  const places = $derived.by((): Place[] => {
    const all: Place[] = [
      ...paneRows(),
      ...SHORTCUTS.map((one): Place => ({
        section: 'shortcuts',
        label: one.label(),
        text: [shortcuts.hint(one.id) ?? '', t('Shortcuts')],
      })),
      ...exportActions().map((action): Place => ({
        section: 'export',
        label: action.label,
        text: [],
      })),
    ]

    return all.map((place) => ({ ...place, text: [...place.text, titleOf(place.section)] }))
  })

  const found = $derived(search(query, panes, places))

  $effect(() => {
    if (!SECTIONS.some((one) => one.id === settings.section)) settings.section = 'account'
  })

  $effect(() => {
    if (settings.open) return
    store.close()
    settings.landsOnField = false
  })

  $effect(() => {
    if (!settings.open || settings.section !== 'account') leaving = false
  })

  let body = $state<HTMLElement>()

  $effect(() => {
    const label = landing.label
    const box = body
    if (!label || !box || !settings.open) return

    query = ''
    const frame = requestAnimationFrame(() => {
      landing.label = null
      const row = [...box.querySelectorAll<HTMLElement>('.nib-setting')].find((one) =>
        one.querySelector('.name')?.textContent.trim().startsWith(label),
      )
      if (!row) return

      row.scrollIntoView({ block: 'center' })
      row.classList.add('landed')
      void waited(LIT).then(() => row.classList.remove('landed'))
    })

    return () => cancelAnimationFrame(frame)
  })

  function go(section: Section) {
    query = ''
    settings.section = section
    settings.listing = false
  }

  const isWindows = isDesktop && navigator.userAgent.includes('Windows')

  async function rename(name: string) {
    settings.error = null
    try {
      await account.rename(name)
    } catch (error) {
      settings.error = message(error, 'that did not work')
    }
  }

  const fraction = (field: Extract<Field, { kind: 'slider' }>, value: number) =>
    ((value - field.min) / (field.max - field.min)) * 100

  function dialled(
    field: Extract<Field, { kind: 'slider' }>,
    input: HTMLInputElement,
    kept: boolean,
  ) {
    const least = field.least?.() ?? field.min
    let value = Number(input.value)
    if (value < least) {
      value = least
      input.value = String(least)
    }
    if (kept || !field.preview) field.set(value)
    else field.preview(value)
  }

  function placing(side: PictureSide, press: PointerEvent) {
    const thumb = press.currentTarget
    if (!(thumb instanceof HTMLElement) || press.button !== 0) return
    const start = { x: press.clientX, y: press.clientY }
    let dragged = false
    thumb.setPointerCapture(press.pointerId)

    const at = (event: PointerEvent): [number, number] => {
      const box = thumb.getBoundingClientRect()
      return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]
    }
    const move = (event: PointerEvent) => {
      if (!dragged && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return
      if (!side.picture()) return
      dragged = true
      side.place(...at(event), false)
    }
    const up = (event: PointerEvent) => {
      thumb.removeEventListener('pointermove', move)
      thumb.removeEventListener('pointerup', up)
      thumb.removeEventListener('pointercancel', up)
      if (event.type === 'pointercancel') return
      if (dragged) side.place(...at(event), true)
      else side.choose()
    }
    thumb.addEventListener('pointermove', move)
    thumb.addEventListener('pointerup', up)
    thumb.addEventListener('pointercancel', up)
  }

  const rebind = new Rebind()
  let keyFilter = $state('')

  const shown = (key: string | null) => (key ? showCombination(key, shortcuts.platform) : null)

  const presetChoices = $derived([
    ...PRESETS.map((one) => ({ value: one.id, label: one.label() })),
    ...(shortcuts.preset === 'custom' ? [{ value: 'custom', label: t('Custom') }] : []),
  ])

  async function choosePreset(id: string) {
    const preset = presetById(id)
    if (!preset) return

    if (shortcuts.preset === 'custom') {
      const sure = await prompt.confirm({
        title: t('Replace your own keys?'),
        detail: t('The keys you changed go back to what this keyboard says.'),
        confirmLabel: t('Replace'),
      })
      if (!sure) return
    }

    shortcuts.choose(preset)
  }

  const keyGroups = $derived.by(() => {
    const needle = keyFilter.trim().toLowerCase()
    const has = (text: string | null) => !!text && text.toLowerCase().includes(needle)

    return CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label(),
      rows: SHORTCUTS.filter((one) => one.category === category.id).filter(
        (one) =>
          !needle ||
          has(one.label()) ||
          has(shown(shortcuts.keyFor(one.id))) ||
          has(category.label()),
      ),
    })).filter((group) => group.rows.length)
  })

  let barFilter = $state('')

  let dragging = $state<number | null>(null)
  let dropAt = $state<number | null>(null)

  const barOffers = $derived.by(() => {
    const needle = barFilter.trim().toLowerCase()
    const held = new Set(toolbar.ids)

    return CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label(),
      rows: SHORTCUTS.filter(
        (one) =>
          one.category === category.id &&
          runnable(one.id) &&
          !held.has(one.id) &&
          (!needle ||
            one.label().toLowerCase().includes(needle) ||
            category.label().toLowerCase().includes(needle)),
      ),
    })).filter((group) => group.rows.length)
  })

  const pullChoices = $derived([
    { value: NOTHING, label: t('Nothing') },
    ...CATEGORIES.flatMap((category) =>
      SHORTCUTS.filter((one) => one.category === category.id && runnable(one.id)).map((one) => ({
        value: one.id,
        label: `${category.label()}: ${one.label()}`,
      })),
    ),
  ])

  function takeBar(event: DragEvent, at: number) {
    event.dataTransfer?.setData('text/plain', String(at))
    dragging = at
  }

  function overBar(event: DragEvent, at: number) {
    if (dragging === null || dragging === at) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropAt = at
  }

  function dropBar(event: DragEvent, at: number) {
    event.preventDefault()
    if (dragging !== null) toolbar.move(dragging, at)
    dragging = null
    dropAt = null
  }

  $effect(() => {
    if (!rebind.listening) return

    const record = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      rebind.record(event)
    }

    window.addEventListener('keydown', record, true)
    const unheard = hearTaps((key) => rebind.tapped(key))

    return () => {
      window.removeEventListener('keydown', record, true)
      unheard()
    }
  })

  $effect(() => {
    if (!settings.open || settings.section !== 'shortcuts') rebind.forget()
  })

  $effect(() => {
    if (settings.open && settings.section === 'shortcuts') globalKeys.follow()
  })

  function appear(node: Element) {
    return viewport.touch
      ? fly(node, { y: 40, duration: dur(240), easing: cubicOut })
      : scale(node, { duration: dur(200), start: 0.97, easing: cubicOut })
  }

  const enter = (x: number) =>
    viewport.touch ? { x, duration: dur(200), easing: cubicOut } : { duration: dur(0) }

  $effect(() => (settings.open ? overlays.show(() => (settings.open = false)) : undefined))
  $effect(() => closeOnBack(settings.open, () => (settings.open = false)))
  $effect(() => closeOnBack(settings.open && !settings.listing, () => (settings.listing = true)))
</script>

{#if settings.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: dur(140) }}
    onclick={() => (settings.open = false)}
  ></div>

  <div
    class="nib-screen is-centred is-steady sheet"
    class:phone={viewport.touch}
    style:height={pageHeight()}
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Settings')}
    transition:appear
  >
    {#if viewport.touch}
      <header class="bar">
        {#if !settings.listing}
          <button
            class="nib-glyph"
            aria-label={t('Back')}
            onclick={() => (settings.listing = true)}
          >
            <svg class="nib-mirror" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>
          </button>
        {/if}

        <h1 class:inset={settings.listing}>
          {settings.listing ? t('Settings') : titleOf(settings.section)}
        </h1>

        <button class="nib-glyph" aria-label={t('Close')} onclick={() => (settings.open = false)}>
          <Cross />
        </button>
      </header>
    {/if}

    {#if !viewport.touch || settings.listing}
      <nav data-scrolls use:scrollbar in:fly={enter(-24)}>
        {#if !viewport.touch}
          <h1>{t('Settings')}</h1>
        {/if}

        <label class="nib-field search">
          <svg class="nib-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
          <input
            bind:value={query}
            placeholder={t('Search settings')}
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        {#if viewport.touch && query}
          {@render results()}
        {:else}
          {#each GROUPS as group, index (index)}
            <div class="group">
              {#each group as item (item.id)}
                <button
                  class="item nib-row"
                  class:is-on={!viewport.touch && !query && settings.section === item.id}
                  onclick={() => go(item.id)}
                >
                  <svg class="glyph nib-row-mark" viewBox="0 0 16 16"
                    ><path d={ICONS[item.id]} /></svg
                  >
                  <span class="nib-row-label">{item.label}</span>
                  <svg class="chevron nib-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg
                  >
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </nav>
    {/if}

    {#if !viewport.touch || !settings.listing}
      <div
        class="body"
        data-scrolls
        bind:this={body}
        use:scrollbar={settings.section}
        in:fly={enter(24)}
      >
        {#if query && !viewport.touch}
          <div class="pane">
            <h2>{t('Search settings')}</h2>
            {@render results()}
          </div>
        {:else}
          {#key settings.section}
            <div class="pane" in:arrive>
              {#if !viewport.touch}
                <h2>{titleOf(settings.section)}</h2>
              {/if}
              {#if declared.problems.length}
                <div class="hint bad declared-problems" role="alert">
                  <strong>{t('The settings file has a problem')}</strong>
                  {#each declared.problems as one, index (index)}<p>{one}</p>{/each}
                </div>
              {/if}
              {@render pane()}
            </div>
          {/key}
        {/if}

        {#if settings.error}
          <p class="hint bad" transition:slide={{ duration: dur(160) }}>{t(settings.error)}</p>
        {/if}
      </div>
    {/if}
  </div>

  <ThemeStore />
{/if}

{#snippet results()}
  {#if found.length}
    <div class="card">
      {#each found as hit, index (index)}
        {#if hit.kind === 'field'}
          {@render row(hit.field, hit.pane.label)}
        {:else}
          <button class="nib-setting setting link" onclick={() => go(hit.section)}>
            <span class="name">{hit.label}<small>{titleOf(hit.section)}</small></span>
            <svg class="chevron nib-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/if}
{/snippet}

{#snippet named(field: Field, where?: string)}
  {#if field.icon}
    <span class="glyph" aria-hidden="true"><Icon icon={null} fallback={field.icon} /></span>
  {/if}
  <span class="name">
    <span class="what"
      >{field.label}{#if field.hint}<Hint text={field.hint} />{/if}</span
    >
    {#if where}<small>{where}</small>{/if}
    {#if field.declared}{@render fileNote()}{/if}
  </span>
{/snippet}

{#snippet fileNote()}
  <small class="declared" title={declared.path}>{t('Set by the settings file')}</small>
{/snippet}

{#snippet row(given: Field, where?: string)}
  {@const field = declared.lock(given)}
  {#if field.kind === 'switch'}
    {@const held = field.get()}
    {@const locked = field.locked?.() ?? false}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="nib-setting setting"
      class:declared={!!field.declared}
      class:pressable={!locked}
      onclick={() => {
        if (!locked) field.set(!field.get())
      }}
    >
      {@render named(field, where)}
      <span
        class="nib-switch"
        class:on={held}
        class:off={locked}
        role="switch"
        tabindex="0"
        aria-checked={held}
        aria-disabled={locked || undefined}
        aria-label={field.label}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          if (!locked) field.set(!field.get())
        }}
      ></span>
    </div>
  {:else if field.kind === 'slider'}
    {@const least = field.least?.() ?? field.min}
    {@const held = Math.max(field.get(), least)}
    <div class="nib-setting setting sliding" class:declared={!!field.declared}>
      {@render named(field, where)}
      <span class="value">{held}{field.unit ?? ''}</span>
      <input
        class="slider nib-slider"
        class:floored={least > field.min}
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={held}
        aria-label={field.label}
        aria-valuemin={least}
        style:--fill="{fraction(field, held)}%"
        style:--least="{fraction(field, least)}%"
        oninput={(event) => dialled(field, event.currentTarget, false)}
        onchange={(event) => dialled(field, event.currentTarget, true)}
      />
    </div>
  {:else if field.kind === 'segmented'}
    {@const held = field.get()}
    <div class="nib-setting setting" class:declared={!!field.declared}>
      {@render named(field, where)}
      <div class="nib-segmented" role="radiogroup" aria-label={field.label} use:segmented>
        {#each field.options as one (one.value)}
          <button
            type="button"
            role="radio"
            aria-checked={one.value === held}
            class:on={one.value === held}
            disabled={one.disabled}
            onclick={() => field.set(one.value)}
          >
            {one.label}
          </button>
        {/each}
      </div>
    </div>
  {:else if field.kind === 'swatches'}
    <div class="nib-setting setting" class:declared={!!field.declared}>
      {@render named(field, where)}
      <div class="nib-setting-value is-wrapping">
        <Swatches
          options={field.options}
          label={field.label}
          chosen={field.get()}
          onchoose={(value: string) => field.set(value)}
          pair={field.pair}
        />
      </div>
    </div>
  {:else if field.kind === 'picture'}
    <div class="nib-setting setting" class:declared={!!field.declared}>
      {@render named(field, where)}
      <span class="pictures">
        {#each field.sides as side, index (index)}
          {@const held = side.picture()}
          {@const [x, y] = side.focus()}
          <span class="picture" class:current={side.current}>
            <button
              type="button"
              class="thumb"
              class:field={!held}
              style:background-image={held ? `url("${held}")` : undefined}
              style:background-position="{x * 100}% {y * 100}%"
              title={side.label}
              aria-label="{t('Choose a picture')}: {side.label}"
              onpointerdown={(event) => placing(side, event)}
              onkeydown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                side.choose()
              }}
            >
              {#if held}<span class="focus" style:left="{x * 100}%" style:top="{y * 100}%"
                ></span>{/if}
            </button>
            {#if side.own()}
              <button
                type="button"
                class="nib-glyph drop"
                title={t('Remove picture')}
                aria-label="{t('Remove picture')}: {side.label}"
                onclick={() => side.remove()}><Cross /></button
              >
            {/if}
          </span>
        {/each}
      </span>
    </div>
  {:else if field.kind === 'value'}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="nib-setting setting pressable"
      class:declared={!!field.declared}
      title={t('Copy')}
      onclick={() => field.press()}
    >
      {@render named(field, where)}
      <span
        class="value said"
        role="button"
        tabindex="0"
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          field.press()
        }}>{field.get()}</span
      >
    </div>
  {:else if field.kind === 'text'}
    {#if field.font}
      <div class="nib-setting setting" class:declared={!!field.declared}>
        {@render named(field, where)}
        <FontPicker
          value={field.get()}
          placeholder={field.placeholder}
          mono={field.font.mono}
          label={field.label}
          onchange={(family: string) => field.set(family)}
        />
      </div>
    {:else}
      <label class="nib-setting setting" class:declared={!!field.declared}>
        {@render named(field, where)}
        <input
          class="nib-field is-value"
          type="text"
          value={field.get()}
          placeholder={field.placeholder}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          oninput={field.live ? (event) => field.set(event.currentTarget.value) : undefined}
          onchange={field.live ? undefined : (event) => field.set(event.currentTarget.value)}
        />
      </label>
    {/if}
  {:else if field.kind === 'select'}
    <div class="nib-setting setting" class:declared={!!field.declared}>
      {@render named(field, where)}
      <div class="nib-setting-value">
        <Select
          value={field.get()}
          options={field.options}
          onchange={(value: string) => field.set(value)}
          label={field.label}
          plain={viewport.touch}
        />
      </div>
    </div>
  {/if}
{/snippet}

{#snippet browserRow()}
  <h3>{t('Browser')}</h3>
  <div class="card">
    <div class="nib-setting setting">
      <span class="name"
        ><span class="what"
          >{t('Default browser')}<Hint
            text={t('Makes Orden the browser that links from other programs open in.')}
          /></span
        ></span
      >
      <DefaultBrowser />
    </div>
    <div class="nib-setting setting" class:declared={declared.holds('general.searchEngine')}>
      <span class="name"
        ><span class="what"
          >{t('Search engine')}<Hint
            text={t('Where words typed into a web tab’s address bar are searched.')}
          /></span
        >{#if declared.holds('general.searchEngine')}{@render fileNote()}{/if}</span
      >
      <div class="nib-setting-value">
        <Select
          value={customising ? CUSTOM : searchEngine.id}
          options={[
            ...enginesFor(navigator.language).map((one) => ({ value: one.id, label: one.name })),
            { value: CUSTOM, label: t('Custom') },
          ]}
          onchange={(value: string) => {
            customising = value === CUSTOM && !searchEngine.custom
            searchEngine.choose(value)
          }}
          label={t('Search engine')}
          plain={viewport.touch}
        />
      </div>
    </div>
    {#if customising || searchEngine.id === CUSTOM}
      <label
        class="nib-setting setting"
        class:declared={declared.holds('general.searchEngineAddress')}
        transition:slide={{ duration: dur(160) }}
      >
        <span class="name"
          ><span class="what"
            >{t('Address')}<Hint
              text={t('The search address, with %s where the words go.')}
            /></span
          >{#if declared.holds('general.searchEngineAddress')}{@render fileNote()}{/if}</span
        >
        <input
          class="nib-field is-value"
          type="url"
          value={searchEngine.custom}
          placeholder="https://example.com/search?q=%s"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          aria-invalid={customBad}
          onchange={(event) => {
            customBad = !searchEngine.setCustom(event.currentTarget.value)
            if (!customBad) customising = false
          }}
        />
      </label>
    {/if}
  </div>
  {#if runsExtensions}
    <h3>{t('Extensions')}</h3>
    <div class="card">
      <ExtensionRows />
    </div>
  {/if}
{/snippet}

{#snippet dictionary()}
  <h3>{t('Your words')}</h3>
  <div class="card">
    <div class="nib-setting setting words">
      <span class="name"
        ><span class="what"
          >{t('Words')}<Hint text={t('Words the spelling check never marks as wrong.')} /></span
        ></span
      >
      {#if modes.spellWords.length}
        <div class="chips">
          {#each modes.spellWords as word (word)}
            <button
              class="nib-tag"
              title={t('Remove')}
              onclick={() => modes.toggleSpellWord(word, view)}
            >
              {word}<Cross small />
            </button>
          {/each}
        </div>
      {/if}
      <input
        class="nib-field is-value add"
        type="text"
        placeholder={t('Add a word')}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        onchange={(event) => {
          modes.toggleSpellWord(event.currentTarget.value, view)
          event.currentTarget.value = ''
        }}
      />
    </div>
  </div>
{/snippet}

{#snippet pane()}
  {#if current}
    {#each current.groups as group, index (index)}
      <h3>{group.title}</h3>
      {#if group.fields.length}
        <div class="card">
          {#each group.fields as field, index (index)}
            {@render row(field)}
          {/each}
        </div>
      {/if}

      {#if group.caption}
        {#if group.caption.url}
          {@const url = group.caption.url}
          <p class="hint caption">
            <button class="link" onclick={() => void openExternal(url)}
              >{group.caption.text}<Outward /></button
            >
          </p>
        {:else}
          <p class="hint caption">{group.caption.text}</p>
        {/if}
      {/if}
    {/each}

    {#if !__EVEN_PLUGIN__ && settings.section === 'general' && isDesktop}
      {@render browserRow()}
    {/if}

    {#if settings.section === 'export'}
      {@render exportExtras()}
    {/if}

    {#if settings.section === 'appearance'}
      {@render appearanceExtras()}
    {/if}

    {#if settings.section === 'spelling'}
      {@render dictionary()}
    {/if}

    {#if settings.section === 'glasses'}
      {@render glassesExtras()}
    {/if}

    {#if resettable(current)}
      <div class="card">
        <button class="nib-action" onclick={() => resetPane(current)}
          >{t('Reset to defaults')}</button
        >
      </div>
    {/if}
  {:else if settings.section === 'account'}
    {#if account.user}
      <h3>{t('Account')}</h3>
      <div class="card">
        <label class="nib-setting setting">
          <span class="name"
            ><span class="what"
              >{t('Display name')}<Hint
                text={t('The name the others see on what you share and in chats.')}
              /></span
            ></span
          >
          <input
            class="nib-field is-value"
            value={account.user.name ?? ''}
            placeholder={t('Your name')}
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
        <div class="nib-setting setting">
          <span class="name">{t('Email')}</span>
          <span class="nib-field is-value is-read">{account.user.email}</span>
        </div>
      </div>

      {#if !__EVEN_PLUGIN__}
        {#await import('./people/ProfileRows.svelte') then rows}
          <rows.default />
        {/await}
      {/if}

      <h3>{t('Storage')}</h3>
      <div class="card">
        <div class="stack">
          <div
            class="nib-meter"
            class:is-full={usage.nearlyFull}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={usage.used}
          >
            <div class="nib-meter-fill" style:width="{Math.min(100, usage.fraction * 100)}%"></div>
          </div>
          <p class="hint">
            {t('{used} of {limit} used.', {
              used: readableSize(usage.used),
              limit: readableSize(usage.limit),
            })}
          </p>
          <p class="hint">
            {plural(workspace.spaces.length, {
              one: '{count} space syncs to your account.',
              other: '{count} spaces sync to your account.',
            })}
            {#if sync.lastSyncedAt}
              {t('Last synced {time}.', {
                time: i18n.when(sync.lastSyncedAt, { timeStyle: 'medium' }),
              })}
            {/if}
          </p>
        </div>
      </div>

      <Security />

      <div class="card">
        <button
          class="nib-action is-danger"
          onclick={() =>
            __EVEN_PLUGIN__
              ? void account.signOut()
              : void import('./ai/vault/leaving').then((one) => one.signOut())}
          >{t('Sign out')}</button
        >
        {#if leaving}
          {#await import('./DeleteAccount.svelte') then flow}
            <flow.default onend={() => (leaving = false)} />
          {/await}
        {:else}
          <button class="nib-action is-danger" onclick={() => (leaving = true)}
            >{t('Delete account')}</button
          >
        {/if}
      </div>
    {:else if account.guest}
      <h3>{t('Account')}</h3>
      <div class="card">
        <label class="nib-setting setting">
          <span class="name">{t('Your name')}</span>
          <input
            class="nib-field is-value"
            value={account.guest.name}
            placeholder={t('Your name')}
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
      </div>
      <p class="hint caption">{t('What the others in this space see.')}</p>

      <button
        class="nib-button"
        onclick={() => {
          settings.open = false
          account.open = true
        }}
      >
        {t('Sign in')}
      </button>
    {:else}
      <p class="lead">{t('Not signed in')}</p>
      <button
        class="nib-button"
        onclick={() => {
          settings.open = false
          account.open = true
        }}
      >
        {t('Sign in')}
      </button>
    {/if}
  {:else if settings.section === 'shortcuts'}
    {@render keyboard()}
  {:else if settings.section === 'mobile'}
    {@render phone()}
  {:else if settings.section === 'sync'}
    <SyncPane />
  {:else if settings.section === 'ai' || settings.section === 'agents' || settings.section === 'llm'}
    {#if !accessDetail}<AiPane />{/if}
    {#if !__EVEN_PLUGIN__}
      {#await import('./access/Access.svelte') then access}
        <access.default ondetail={(open: boolean) => (accessDetail = open)} />
      {/await}
    {/if}
  {:else if !__EVEN_PLUGIN__ && settings.section === 'online'}
    {#await import('./online/OnlinePane.svelte') then pane}
      <pane.default />
    {/await}
  {:else if !__EVEN_PLUGIN__ && settings.section === 'remote'}
    {#await import('./remote/RemotePane.svelte') then pane}
      <pane.default />
    {/await}
  {:else if !__EVEN_PLUGIN__ && settings.section === 'space'}
    {#await import('./settings/SpacePane.svelte') then pane}
      <pane.default />
    {/await}
  {:else if settings.section === 'trash'}
    <RecentlyDeleted />
  {:else if !__EVEN_PLUGIN__ && settings.section === 'import'}
    {#await import('./MigrateRows.svelte') then rows}
      <div class="card">
        <rows.default />
      </div>
    {/await}
  {/if}
{/snippet}

{#snippet exportExtras()}
  <h3>{t('This note')}</h3>
  <div class="card">
    {#each exportActions() as action (action.id)}
      <button class="nib-action" disabled={action.disabled} onclick={action.run}>
        {action.label}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet keyboard()}
  <div class="card">
    <div class="nib-setting setting">
      <span class="name"
        ><span class="what"
          >{t('Shortcuts')}<Hint
            text={t('Which app’s keys Orden follows; any key below can still be changed.')}
          /></span
        ></span
      >
      <div class="nib-setting-value">
        <Select
          value={shortcuts.preset}
          options={presetChoices}
          onchange={(value: string) => void choosePreset(value)}
          label={t('Shortcuts')}
          plain={viewport.touch}
        />
      </div>
    </div>

    {@render row({
      // Modal editing, under the keyboard it belongs with rather than in the
      // editor: choosing the Vim preset turns it on, and this is how it is on
      // over the Obsidian or the Notion map instead.
      kind: 'switch',
      key: 'shortcuts.vim',
      label: t('Vim keys'),
      hint: t('Moves and edits in notes with Vim’s keys.'),
      get: () => modes.vim,
      set: (on) => modes.setVimKeys(on, view),
    })}
  </div>

  <label class="nib-field search">
    <svg class="nib-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
    <input
      bind:value={keyFilter}
      placeholder={t('Search shortcuts')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />
  </label>

  {#each keyGroups as group (group.id)}
    <h3>{group.label}</h3>
    <div class="card">
      {#each group.rows as entry (entry.id)}
        {@const key = shortcuts.keyFor(entry.id)}
        {@const warning = entry.scope === 'fixed' ? null : shortcuts.warning(key)}
        {@const reach = noteFor(globalKeys.keys, entry.id, shown(key))}
        {@const held = declared.holds(shortcutKey(entry.id))}
        <div class="nib-setting setting shortcut" class:declared={held}>
          <span class="name">
            {entry.label()}
            {#if held}{@render fileNote()}{/if}
            {#if entry.alias}<small>{t('Second key')}</small>{/if}
            {#if entry.why}<small>{entry.why()}</small>{/if}
            {#if warning}<small class="caution">{warning}</small>{/if}
            {#if reach}<small class="reach"
                >{reach.text}{#if reach.change}
                  <button class="link" onclick={() => globalKeys.change()}>{t('Change')}</button
                  >{/if}</small
              >{/if}
            {#if rebind.turnedDown?.id === entry.id}<small class="warn"
                >{rebind.turnedDown.reason}</small
              >{/if}
          </span>

          {#if entry.scope === 'fixed'}
            <span class="key held">{shown(key) ?? '–'}</span>
          {:else}
            <button
              class="key"
              class:listening={rebind.listening === entry.id}
              class:none={!key}
              onclick={() => rebind.listen(entry.id)}
            >
              {rebind.listening === entry.id ? t('Press a key…') : (shown(key) ?? t('Not set'))}
            </button>
            <button
              class="nib-glyph revert"
              disabled={!shortcuts.changed(entry.id)}
              title={t('Reset')}
              aria-label={t('Reset')}
              onclick={() => shortcuts.reset(entry.id)}
            >
              <svg viewBox="0 0 16 16">
                <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M4.4 2.6v2.6h2.6" />
              </svg>
            </button>
          {/if}
        </div>

        {#if rebind.clash?.id === entry.id}
          <div class="clash" transition:slide={{ duration: dur(160) }}>
            <span>
              {t('{key} already runs {name}.', {
                key: shown(rebind.clash.key) ?? '',
                name: rebind.clash.holders.map((one) => one.label()).join(', '),
              })}
            </span>
            <button class="nib-chip" onclick={() => rebind.takeOver()}>{t('Take it over')}</button>
            <button class="nib-chip is-quiet" onclick={() => (rebind.clash = null)}
              >{t('Cancel')}</button
            >
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/each}

  <p class="hint">{t('Esc stops recording, Backspace takes the key away.')}</p>

  <div class="card">
    <button class="nib-action" onclick={() => shortcuts.resetAll()}
      >{t('Reset all shortcuts')}</button
    >
  </div>
{/snippet}

{#snippet mark(id: string)}
  {@const glyph = glyphFor(id)}
  <span class="mark">
    {#if glyph}
      <CanvasIcon node={glyph} />
    {:else if lowMark(id)}
      <span class="low">{markFor(id)}</span>
    {:else}
      {markFor(id)}
    {/if}
  </span>
{/snippet}

{#snippet phone()}
  <p class="lead">{t('The bar sits over the keyboard on a phone.')}</p>

  <h3>{t('On the bar')}</h3>
  <div class="card">
    {#each toolbar.ids as id, at (id)}
      <div
        class="nib-setting setting button"
        class:landing={dropAt === at}
        role="group"
        aria-label={nameFor(id)}
        draggable={!viewport.touch}
        ondragstart={(event) => takeBar(event, at)}
        ondragover={(event) => overBar(event, at)}
        ondragleave={() => (dropAt = null)}
        ondragend={() => {
          dragging = null
          dropAt = null
        }}
        ondrop={(event) => dropBar(event, at)}
      >
        {@render mark(id)}
        <span class="name">{nameFor(id)}</span>
        <button
          class="nib-glyph revert"
          disabled={at === 0}
          title={t('Move up')}
          aria-label={t('Move up')}
          onclick={() => toolbar.move(at, at - 1)}
        >
          <svg viewBox="0 0 16 16"><path d="M4.5 9.5L8 6l3.5 3.5" /></svg>
        </button>
        <button
          class="nib-glyph revert"
          disabled={at === toolbar.ids.length - 1}
          title={t('Move down')}
          aria-label={t('Move down')}
          onclick={() => toolbar.move(at, at + 1)}
        >
          <svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
        </button>
        <button
          class="nib-glyph revert"
          title={t('Take it off')}
          aria-label={t('Take it off')}
          onclick={() => toolbar.remove(id)}
        >
          <Cross />
        </button>
      </div>
    {:else}
      <p class="note">{t('Nothing on the bar.')}</p>
    {/each}
  </div>

  <div class="card">
    <button class="nib-action" disabled={!toolbar.changed} onclick={() => toolbar.reset()}>
      {t('Reset the bar')}
    </button>
  </div>

  <h3>{t('Pulling down')}</h3>
  <div class="card">
    <div class="nib-setting setting">
      <span class="name"
        ><span class="what"
          >{t('A pull past the top runs')}<Hint
            text={t('What pulling a note down past its top does on a phone.')}
          /></span
        ></span
      >
      <div class="nib-setting-value">
        <Select
          value={pull.id}
          options={pullChoices}
          onchange={(value: string) => pull.choose(value)}
          label={t('A pull past the top runs')}
          plain={viewport.touch}
        />
      </div>
    </div>
  </div>

  <h3>{t('Everything else')}</h3>
  <label class="nib-field search">
    <svg class="nib-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
    <input
      bind:value={barFilter}
      placeholder={t('Search commands')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />
  </label>

  {#each barOffers as group (group.id)}
    <h3>{group.label}</h3>
    <div class="card">
      {#each group.rows as entry (entry.id)}
        <div class="nib-setting setting button">
          {@render mark(entry.id)}
          <span class="name">{entry.label()}</span>
          <button
            class="nib-glyph revert"
            title={t('Put it on the bar')}
            aria-label={t('Put it on the bar')}
            onclick={() => toolbar.add(entry.id)}
          >
            <svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/each}
{/snippet}

{#snippet glassesExtras()}
  <h3>{t('Questions')}</h3>
  <div class="card">
    {#if glassesKey.set && !replacingKey}
      <div class="nib-setting setting keyed">
        <span class="name"
          ><span class="what"
            >{t('OpenAI key')}<Hint
              text={t('The OpenAI key the glasses ask their questions with.')}
            /></span
          ></span
        >
        <div class="row">
          <span class="hint">{t('set, ends in …{tail}', { tail: glassesKey.tail })}</span>
          <button class="nib-chip" onclick={() => (replacingKey = true)}>{t('Replace')}</button>
          <button class="nib-chip is-quiet" onclick={() => void offered.remove()}
            >{t('Remove')}</button
          >
        </div>
      </div>
    {:else}
      <!-- svelte-ignore a11y_autofocus -->
      <label class="nib-setting setting">
        <span class="name"
          ><span class="what"
            >{t('OpenAI key')}<Hint
              text={t('The OpenAI key the glasses ask their questions with.')}
            /></span
          ></span
        >
        <input
          class="nib-field is-value"
          type="password"
          value=""
          placeholder="sk-"
          spellcheck="false"
          autocomplete="off"
          autofocus={replacingKey}
          onchange={(event) => {
            replacingKey = false
            void offered.take(event.currentTarget.value)
          }}
        />
      </label>
    {/if}

    {#if offered.models.length}
      <div class="nib-setting setting">
        <span class="name"
          ><span class="what"
            >{t('Model')}<Hint
              text={t('The model that answers what you ask on the glasses.')}
            /></span
          ></span
        >
        <div class="nib-setting-value">
          <Select
            value={modes.glassesModel}
            options={offered.models.map((one) => ({ value: one, label: one }))}
            onchange={(value: string) => modes.setGlassesModel(value)}
            label={t('Model')}
            plain={viewport.touch}
          />
        </div>
      </div>
      <div class="nib-setting setting">
        <span class="name"
          ><span class="what"
            >{t('Reasoning')}<Hint
              text={t('How long the model thinks before it answers; longer is slower.')}
            /></span
          ></span
        >
        <div class="nib-setting-value">
          <Select
            value={modes.glassesEffort}
            options={EFFORT_WORDS.map((one) => ({ value: one.value, label: t(one.label) }))}
            onchange={(value: string) => modes.setGlassesEffort(value)}
            label={t('Reasoning')}
            plain={viewport.touch}
          />
        </div>
      </div>
    {/if}
  </div>

  <p class="hint caption">
    {#if offered.said}{offered.said}{:else}{t(
        'Kept encrypted on your account, and never shown again.',
      )}{/if}
  </p>
{/snippet}

{#snippet appearanceExtras()}
  <div class="card">
    <div class="nib-setting setting">
      <span class="name">{t('Themes')}</span>
      <button class="nib-chip" onclick={() => store.show()}>{t('Browse')}</button>
    </div>
  </div>

  {#if isDesktop}
    <h3>{t('Custom')}</h3>
    <div class="card">
      <button class="nib-action" onclick={() => theme.reload()}
        >{t('Reload themes and custom CSS')}</button
      >
      <BrowserThemes />

      {#if isWindows}
        {@render row({
          kind: 'switch',
          label: t('Show in Explorer’s New menu'),
          hint: t(
            'Adds a Markdown document to the New menu you get by right-clicking in File Explorer.',
          ),
          get: () => settings.newMenu,
          set: (on) => void settings.setNewMenu(on),
        })}
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  .scrim {
    --scrim-z: var(--z-settings);
  }

  .sheet {
    --screen-width: var(--screen-panes);
    z-index: var(--z-settings);
    display: grid;
    grid-template-columns: 14rem 1fr;
    overflow: hidden;
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-4) var(--space-3);
    border-inline-end: 1px solid var(--line);
    background: var(--bg);
    overflow-y: auto;
  }

  nav > * {
    flex: none;
  }

  nav h1 {
    margin: 0 0 var(--space-3);
    padding: 0 var(--row-pad);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .search {
    flex: none;
    margin-bottom: var(--space-3);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .group + .group {
    margin-top: var(--space-2);
  }

  .setting .name .what,
  .setting .value {
    unicode-bidi: isolate;
  }

  .item .glyph {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .item .chevron {
    display: none;
  }

  .item .nib-row-label {
    white-space: normal;
  }

  .body {
    padding: var(--space-5) var(--space-6);
    overflow-y: auto;
  }

  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .pane h2 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: 1.15em;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .pane h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .pane h3:first-child,
  .pane h2 + h3 {
    margin-top: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  .setting .glyph {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    font-size: var(--icon-md);
    color: var(--muted);
    stroke: currentColor;
    stroke-width: 1.6;
  }

  .setting .name {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .setting .name .what {
    display: block;
  }

  .setting .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .setting .nib-segmented {
    flex: none;
    min-width: var(--setting-value);
  }

  .setting .value {
    flex: none;
    width: 4.5rem;
    text-align: end;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .setting .value.said {
    flex: none;
    width: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    unicode-bidi: isolate;
    user-select: text;
    -webkit-user-select: text;
  }

  .setting .chevron {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    button.setting:hover,
    .setting.pressable:hover {
      color: var(--text-strong);
    }
  }

  button.setting:focus-visible,
  .setting .value.said:focus-visible {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .setting.button {
    gap: var(--space-2);
  }

  .setting .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-strong);
    font-size: var(--text-sm);
  }

  .setting .mark :global(svg) {
    --mark: 1.2em;

    display: block;
  }

  .setting .mark .low {
    display: inline-block;
    transform: translateY(0.2em);
  }

  .setting.button.landing {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .body :global(.nib-setting.landed) {
    border-radius: var(--radius-row);
    background: var(--accent-soft);
    box-shadow: 0 0 0 var(--space-2) var(--accent-soft);
  }

  .setting.shortcut {
    gap: var(--space-2);
  }

  .key {
    flex: none;
    min-width: 7rem;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.02em;
    text-align: center;
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    button.key:hover {
      border-color: var(--line-strong);
      color: var(--text-strong);
    }
  }

  button.key:focus-visible {
    outline-offset: 2px;
  }

  .key.listening {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .key.none {
    color: var(--muted);
  }

  .key.held {
    background: none;
    color: var(--muted);
  }

  .revert:disabled {
    visibility: hidden;
  }

  .clash {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 10px 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.5;
  }

  .clash span {
    flex: 1;
    min-width: 12rem;
  }

  .setting .name small.reach {
    overflow-wrap: anywhere;
  }

  .setting .name small.reach .link {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: default;
  }

  .setting.declared > :not(.name, .glyph) {
    pointer-events: none;
    opacity: 0.55;
  }

  .declared-problems p {
    margin: 4px 0 0;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .setting .name small.caution {
    color: var(--muted-strong);
  }

  .setting .name small.warn {
    color: var(--danger);
  }

  .slider {
    width: 11rem;
  }

  .lead {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-strong);
    font-weight: var(--weight-row);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.caption {
    margin-top: calc(-1 * var(--space-2));
  }

  .hint.caption .link {
    padding-block: 0;
    padding-inline-start: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: inherit;
    line-height: inherit;
    color: var(--accent);
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .hint.caption .link:hover {
      color: var(--accent-hover);
    }
  }

  .hint.bad {
    color: var(--danger);
  }

  .nib-button {
    align-self: flex-start;
  }

  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .words {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }

  .words > .add {
    inline-size: auto;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .slider.floored::-webkit-slider-runnable-track {
    background:
      linear-gradient(var(--line-strong), var(--line-strong)) var(--dir-start) / var(--least) 100%
        no-repeat,
      linear-gradient(var(--accent), var(--accent)) var(--dir-start) / var(--fill) 100% no-repeat,
      var(--surface-3);
  }

  .pictures {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .picture {
    position: relative;
    display: flex;
  }

  .thumb {
    position: relative;
    flex: none;
    width: 64px;
    aspect-ratio: 16 / 10;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--surface-2) center / cover no-repeat;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent);
    cursor: default;
    touch-action: none;
    transition:
      translate var(--dur-fast) var(--ease-out),
      scale var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .current .thumb {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4px var(--accent);
  }

  .thumb.field {
    background-image: var(--wallpaper-field);
  }

  .focus {
    position: absolute;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 50%;
    box-shadow:
      0 0 0 1.5px #fff,
      0 0 0 2.5px rgb(0 0 0 / 0.35);
    pointer-events: none;
  }

  .drop {
    position: absolute;
    top: -8px;
    inset-inline-end: -8px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface-3);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .picture:hover .drop,
  .drop:focus-visible {
    opacity: 1;
  }

  @media (hover: none) {
    .drop {
      opacity: 1;
    }
  }

  @media (hover: hover) {
    .thumb:hover {
      translate: 0 -1px;
    }
  }

  .thumb:active {
    translate: 0 0;
    scale: 0.97;
  }

  .sheet.phone {
    inset: 0;
    top: 0;
    left: 0;
    translate: none;
    width: 100%;
    height: 100dvh;
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: var(--bg);
  }

  .sheet.phone .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: calc(var(--touch-row) + var(--inset-top));
    padding: var(--inset-top) 6px 0;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .sheet.phone .bar h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--touch-text);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sheet.phone .bar h1.inset {
    padding-inline-start: 10px;
  }

  .sheet.phone nav {
    gap: 0;
    padding: var(--space-3) var(--space-4) calc(var(--space-5) + var(--touch-bottom));
    border-inline-end: none;
    background: none;
  }

  .sheet.phone .search {
    margin-bottom: var(--space-4);
    background: var(--surface);
  }

  .sheet.phone .group {
    gap: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  .sheet.phone .group + .group {
    margin-top: var(--space-4);
  }

  .sheet.phone .item {
    position: relative;
    border-radius: 0;
    color: var(--text);
  }

  .sheet.phone .item + .item::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: calc(var(--touch-pad) + var(--touch-icon) + var(--touch-gap));
    inset-inline-end: 0;
    height: 1px;
    background: var(--line);
  }

  .sheet.phone .item .glyph {
    width: var(--touch-icon);
    height: var(--touch-icon);
    color: var(--accent);
    stroke-width: 1.2;
  }

  .sheet.phone .item .chevron {
    display: block;
    flex: none;
    width: var(--touch-mark);
    height: var(--touch-mark);
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sheet.phone .body {
    padding: var(--space-3) var(--space-4) calc(var(--space-6) + var(--touch-bottom));
  }

  .sheet.phone .pane {
    gap: var(--space-4);
  }

  .sheet.phone .pane h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2)) 14px;
    font-size: 13px;
    color: var(--muted);
  }

  .sheet.phone .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  .sheet.phone .card > .stack {
    padding: var(--touch-pad);
  }

  .sheet.phone .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  .sheet.phone .setting > .name > small {
    font-size: var(--text-base);
  }

  .sheet.phone .setting + .setting::before,
  .sheet.phone :global(.nib-action + .setting::before),
  .sheet.phone :global(.nib-action + .nib-action::before) {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: var(--touch-pad);
    inset-inline-end: 0;
    height: 1px;
    background: var(--line);
  }

  .sheet.phone button.setting:active {
    background: var(--surface-2);
  }

  .sheet.phone button.setting:focus-visible {
    border-radius: 0;
  }

  .sheet.phone .setting.sliding {
    flex-wrap: wrap;
    padding-bottom: 6px;
  }

  .sheet.phone .setting.keyed {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  .sheet.phone .setting.keyed .row {
    flex: 1 0 100%;
    flex-wrap: wrap;
  }

  .sheet.phone .setting.keyed .hint {
    margin-inline-end: auto;
  }

  .sheet.phone .setting .value {
    width: auto;
    font-size: var(--text-base);
  }

  .sheet.phone .slider {
    order: 3;
    width: 100%;
  }

  .sheet.phone :global(.nib-action) {
    position: relative;
    padding: var(--space-2) var(--touch-pad);
    color: var(--accent);
  }

  .sheet.phone :global(.nib-action.is-danger) {
    color: var(--danger);
  }

  .sheet.phone :global(.nib-action:active:not(:disabled)) {
    background: var(--surface-press);
  }

  .sheet.phone .key {
    min-width: 5.5rem;
    min-height: var(--touch-target);
    padding: 7px 10px;
    font-size: var(--text-sm);
  }

  .sheet.phone .setting .mark {
    width: 34px;
    height: 34px;
    font-size: var(--text-base);
  }

  .sheet.phone .clash {
    padding: 10px var(--touch-pad);
  }

  .sheet.phone .hint,
  .sheet.phone .note {
    font-size: var(--text-base);
  }

  .sheet.phone .hint.caption {
    margin: calc(-1 * var(--space-2)) var(--touch-pad) 0;
  }

  .sheet.phone .lead {
    font-size: var(--touch-text);
  }

  .sheet.phone .nib-button {
    align-self: stretch;
  }
</style>
