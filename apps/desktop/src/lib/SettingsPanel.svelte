<script lang="ts">
  import { dropOver } from './drag-paths'
  import { closeOnBack } from './backstack.svelte'
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import Swatches from './Swatches.svelte'
  import { account } from './account.svelte'
  import { arrive, segmented } from './slide'
  import CanvasIcon from './CanvasIcon.svelte'
  import DefaultBrowser from './settings/DefaultBrowser.svelte'
  import FontPicker from './settings/FontPicker.svelte'
  import ExtensionRows from './settings/ExtensionRows.svelte'
  import { enginesFor } from './web-tab/engines'
  import { CUSTOM, searchEngine } from './web-tab/search-engine.svelte'
  import Hint from './Hint.svelte'
  import Switch from './Switch.svelte'
  import Outward from './Outward.svelte'
  import Icon from './Icon.svelte'
  import { localDate } from './region'
  import { message } from './message'
  import AiPane from './AiPane.svelte'
  import { SEARCH_MARK } from './panel-marks'
  import Security from './Security.svelte'
  import SyncPane from './SyncPane.svelte'
  import RecentlyDeleted from './RecentlyDeleted.svelte'
  import { holdScroll } from './kept-scroll'
  import { scrollbar } from './scrollbar'
  import Select from './Select.svelte'
  import { glassesOn, settings, type Section } from './settings.svelte'
  import { CATEGORIES, SHORTCUTS, shortcuts } from './shortcuts.svelte'
  import { runnable } from './shortcuts/registry'
  import { glyphFor, lowMark, markFor, nameFor, toolbar } from './toolbar.svelte'
  import { PRESETS, presetById } from './shortcuts/presets'
  import { showCombination } from './keys'
  import { prompt } from './prompt.svelte'
  import { Rebind } from './settings/rebind.svelte'
  import { accelerator } from './accelerator'
  import { globalKeys, noteFor } from './global-keys.svelte'
  import { hearTaps } from './tapped'
  import { landing } from './settings/landing.svelte'
  import { places as paneRows } from './settings/places'
  import { ICONS, sectionGroups } from './settings/sections'
  import { type Place, search } from './settings-search'
  import { sync } from './sync.svelte'
  import { isDesktop, openExternal } from './tauri'
  import { runsExtensions } from './web-tab/extensions.svelte'
  import { theme } from './theme/src/api'
  import ThemeStore from './ThemeStore.svelte'
  import { store } from './theme-looks/src/api'
  import { type Field, type PictureSide, preferences, resetPane, resettable } from './preferences'
  import { glassesKey } from './even/key.svelte'
  import { EFFORT_WORDS, Offered } from './even/offered.svelte'
  import { modes } from './modes.svelte'
  import { readableSize, usage } from './usage.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'
  import { dur, fly, slide } from './motion'
  import { waited } from './timing'
  import Cross from './Cross.svelte'

  const offered = new Offered()

  let replacingKey = $state(false)
  let customising = $state(false)
  let customBad = $state(false)

  let leaving = $state(false)

  const LIT = 1400

  const GROUPS = $derived(sectionGroups())

  const SECTIONS = $derived(GROUPS.flat())
  const titleOf = (id: Section) => SECTIONS.find((one) => one.id === id)?.label ?? ''

  const SIDE_BY_SIDE = 560

  let width = $state(0)

  const stacked = $derived(viewport.touch || viewport.narrow || (width > 0 && width < SIDE_BY_SIDE))

  let query = $state('')
  let accessDetail = $state(false)

  const panes = $derived(preferences())
  const current = $derived(panes.find((one) => one.id === settings.section))

  const places = $derived.by((): Place[] => {
    const all: Place[] = [
      ...paneRows(),
      ...SHORTCUTS.map((one): Place => ({
        section: 'shortcuts',
        label: one.label(),
        text: [shortcuts.hint(one.id) ?? '', 'Shortcuts'],
      })),
    ]

    return all.map((place) => ({ ...place, text: [...place.text, titleOf(place.section)] }))
  })

  const found = $derived(search(query, panes, places))

  $effect(() => {
    if (!SECTIONS.some((one) => one.id === settings.section)) settings.section = 'account'
  })

  $effect(() => () => {
    store.close()
    rebind.forget()
    settings.landsOnField = false
  })

  $effect(() => {
    if (settings.section !== 'account') leaving = false
  })

  let sheet = $state<HTMLElement>()

  $effect(() => {
    if (!settings.asked || !sheet) return
    const into = sheet
    void tick().then(() =>
      ['.bar button', '.item.is-on', '.item']
        .map((one) => into.querySelector<HTMLElement>(one))
        .find(Boolean)
        ?.focus({ preventScroll: true }),
    )
  })

  let body = $state<HTMLElement>()

  $effect(() => {
    const label = landing.label
    const box = body
    if (!label || !box) return

    query = ''
    keyFilter = ''
    const frame = requestAnimationFrame(() => {
      landing.label = null
      const row = [...box.querySelectorAll<HTMLElement>('.orden-setting')].find((one) =>
        one.querySelector('.name')?.textContent.trim().startsWith(label),
      )
      if (!row) return

      for (let one: HTMLElement | null = row; one && one !== box; one = one.parentElement) {
        holdScroll(one)
      }
      holdScroll(box)
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
    ...(shortcuts.preset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
  ])

  async function choosePreset(id: string) {
    const preset = presetById(id)
    if (!preset) return

    if (shortcuts.preset === 'custom') {
      const sure = await prompt.confirm({
        title: 'Replace your own keys?',
        detail: 'The keys you changed go back to what this keyboard says.',
        confirmLabel: 'Replace',
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
      rows: SHORTCUTS.filter(
        (one) => one.category === category.id && one.shown?.() !== false,
      ).filter(
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
    if (settings.section !== 'shortcuts') rebind.forget()
  })

  $effect(() => {
    if (settings.section === 'shortcuts') globalKeys.follow()
  })

  const enter = (x: number) =>
    stacked ? { x, duration: dur(200), easing: cubicOut } : { duration: dur(0) }

  $effect.pre(() => closeOnBack(stacked && !settings.listing, () => (settings.listing = true)))
</script>

<div
  bind:this={sheet}
  class="sheet"
  class:phone={stacked}
  bind:clientWidth={width}
  role="region"
  aria-label="Settings"
  data-region="editor"
>
  {#if stacked && !settings.listing}
    <header class="bar">
      <button class="orden-glyph" aria-label="Back" onclick={() => (settings.listing = true)}>
        <svg class="orden-mirror" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>
      </button>

      <h2>{titleOf(settings.section)}</h2>
    </header>
  {/if}

  {#if !stacked || settings.listing}
    <nav data-scrolls use:scrollbar in:fly={enter(-24)}>
      {#if !stacked}
        <h1>Settings</h1>
      {/if}

      <label class="orden-field search">
        <svg class="orden-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
        <input
          bind:value={query}
          placeholder="Search settings"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
        />
      </label>

      {#if stacked && query}
        {@render results()}
      {:else}
        {#each GROUPS as group, index (index)}
          <div class="group">
            {#each group as item (item.id)}
              <button
                class="item orden-row"
                class:is-on={!stacked && !query && settings.section === item.id}
                onclick={() => go(item.id)}
              >
                <svg class="glyph orden-row-mark" viewBox="0 0 16 16"
                  ><path d={ICONS[item.id]} /></svg
                >
                <span class="orden-row-label">{item.label}</span>
                <svg class="chevron orden-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg
                >
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </nav>
  {/if}

  {#if !stacked || !settings.listing}
    <div
      class="body"
      class:filled={settings.section === 'shortcuts' && !query}
      data-scrolls
      data-scroll-key={query && !stacked ? 'search' : settings.section}
      bind:this={body}
      use:scrollbar={settings.section}
      in:fly={enter(24)}
    >
      {#if query && !stacked}
        <div class="pane">
          <h2>Search settings</h2>
          {@render results()}
        </div>
      {:else}
        {#key settings.section}
          <div class="pane" in:arrive>
            {#if !stacked}
              <h2>{titleOf(settings.section)}</h2>
            {/if}
            {@render pane()}
          </div>
        {/key}
      {/if}

      {#if settings.error}
        <p class="hint bad" transition:slide={{ duration: dur(160) }}>{settings.error}</p>
      {/if}
    </div>
  {/if}
</div>

<ThemeStore />

{#snippet results()}
  {#if found.length}
    <div class="card">
      {#each found as hit, index (index)}
        {#if hit.kind === 'field'}
          {@render row(hit.field, hit.pane.label)}
        {:else}
          {@const label = hit.kind === 'place' ? hit.label : ''}
          <button
            class="orden-setting setting link"
            onclick={() => {
              go(hit.section)
              landing.label = label
            }}
          >
            <span class="name">{hit.label}<small>{titleOf(hit.section)}</small></span>
            <svg class="chevron orden-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">Nothing matches.</p>
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
  </span>
{/snippet}

{#snippet row(field: Field, where?: string)}
  {#if field.kind === 'switch'}
    {@const held = field.get()}
    {@const locked = field.locked?.() ?? false}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="orden-setting setting"
      class:pressable={!locked}
      onclick={() => {
        if (!locked) field.set(!field.get())
      }}
    >
      {@render named(field, where)}
      <Switch
        on={held}
        label={field.label}
        disabled={locked}
        onchange={(on: boolean) => field.set(on)}
      />
    </div>
  {:else if field.kind === 'slider'}
    {@const least = field.least?.() ?? field.min}
    {@const held = Math.max(field.get(), least)}
    <div class="orden-setting setting sliding">
      {@render named(field, where)}
      <span class="value">{held}{field.unit ?? ''}</span>
      <input
        class="slider orden-slider"
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
    <div class="orden-setting setting">
      {@render named(field, where)}
      <div class="orden-segmented" role="radiogroup" aria-label={field.label} use:segmented>
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
    <div class="orden-setting setting">
      {@render named(field, where)}
      <div class="orden-setting-value is-wrapping">
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
    <div class="orden-setting setting">
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
              aria-label="Choose a picture: {side.label}"
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
                class="orden-glyph drop"
                title="Remove picture"
                aria-label="Remove picture: {side.label}"
                onclick={() => side.remove()}><Cross /></button
              >
            {/if}
          </span>
        {/each}
      </span>
    </div>
  {:else if field.kind === 'value'}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-setting setting pressable" title={field.does} onclick={() => field.press()}>
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
      <div class="orden-setting setting">
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
      <label class="orden-setting setting">
        {@render named(field, where)}
        <input
          class="orden-field is-value"
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
    <div class="orden-setting setting">
      {@render named(field, where)}
      <div class="orden-setting-value">
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
  <h3>Browser</h3>
  <div class="card">
    <div class="orden-setting setting">
      <span class="name"
        ><span class="what"
          >Default browser<Hint
            text="Makes Orden the browser that links from other programs open in."
          /></span
        ></span
      >
      <DefaultBrowser />
    </div>
    <div class="orden-setting setting">
      <span class="name"
        ><span class="what"
          >Search engine<Hint
            text="Where words typed into a web tab’s address bar are searched."
          /></span
        ></span
      >
      <div class="orden-setting-value">
        <Select
          value={customising ? CUSTOM : searchEngine.id}
          options={[
            ...enginesFor(navigator.language).map((one) => ({ value: one.id, label: one.name })),
            { value: CUSTOM, label: 'Custom' },
          ]}
          onchange={(value: string) => {
            customising = value === CUSTOM && !searchEngine.custom
            searchEngine.choose(value)
          }}
          label="Search engine"
          plain={viewport.touch}
        />
      </div>
    </div>
    {#if customising || searchEngine.id === CUSTOM}
      <label class="orden-setting setting" transition:slide={{ duration: dur(160) }}>
        <span class="name"
          ><span class="what"
            >Address<Hint text="The search address, with %s where the words go." /></span
          ></span
        >
        <input
          class="orden-field is-value"
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
    <h3>Extensions</h3>
    <div class="card">
      <ExtensionRows />
    </div>
  {/if}
{/snippet}

{#snippet pane()}
  {#if current}
    {#each current.groups as group, index (index)}
      <h3>{group.title}</h3>
      {#if group.fields.length}
        <div class="card">
          {#each group.fields as field, index (index)}
            {@render row(field)}
            {#if field.key === 'appearance.mode'}{@render themeTools()}{/if}
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

    {#if settings.section === 'experimental' && glassesOn()}
      {@render glassesExtras()}
    {/if}

    {#if resettable(current)}
      <div class="card">
        <button class="orden-action" onclick={() => resetPane(current)}>Reset to defaults</button>
      </div>
    {/if}
  {:else if settings.section === 'account'}
    {#if account.user}
      <h3>Account</h3>
      <div class="card">
        <label class="orden-setting setting">
          <span class="name"
            ><span class="what"
              >Display name<Hint
                text="The name the others see on what you share and in chats."
              /></span
            ></span
          >
          <input
            class="orden-field is-value"
            value={account.user.name ?? ''}
            placeholder="Your name"
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
        <div class="orden-setting setting">
          <span class="name">Email</span>
          <span class="orden-field is-value is-read">{account.user.email}</span>
        </div>
      </div>

      {#if !__EVEN_PLUGIN__}
        {#await import('./people/ProfileRows.svelte') then rows}
          <rows.default />
        {/await}
      {/if}

      <h3>Storage</h3>
      <div class="card">
        <div class="stack">
          <div
            class="orden-meter"
            class:is-full={usage.nearlyFull}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={usage.used}
          >
            <div
              class="orden-meter-fill"
              style:width="{Math.min(100, usage.fraction * 100)}%"
            ></div>
          </div>
          <p class="hint">
            {readableSize(usage.used)} of {readableSize(usage.limit)} used.
          </p>
          <p class="hint">
            {workspace.spaces.length === 1
              ? '1 space syncs to your account.'
              : `${workspace.spaces.length} spaces sync to your account.`}
            {#if sync.lastSyncedAt}
              Last synced {localDate(sync.lastSyncedAt, { timeStyle: 'medium' })}.
            {/if}
          </p>
        </div>
      </div>

      <Security />

      <div class="card">
        <button
          class="orden-action is-danger"
          onclick={() =>
            __EVEN_PLUGIN__
              ? void account.signOut('asked')
              : void import('./ai/vault/leaving').then((one) => one.signOut())}>Sign out</button
        >
        {#if leaving}
          {#await import('./DeleteAccount.svelte') then flow}
            <flow.default onend={() => (leaving = false)} />
          {/await}
        {:else}
          <button class="orden-action is-danger" onclick={() => (leaving = true)}
            >Delete account</button
          >
        {/if}
      </div>
    {:else if account.guest}
      <h3>Account</h3>
      <div class="card">
        <label class="orden-setting setting">
          <span class="name">Your name</span>
          <input
            class="orden-field is-value"
            value={account.guest.name}
            placeholder="Your name"
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
      </div>
      <p class="hint caption">What the others in this space see.</p>

      <button class="orden-button" onclick={() => (account.open = true)}> Sign in </button>
    {:else}
      <p class="lead">Not signed in</p>
      <button class="orden-button" onclick={() => (account.open = true)}> Sign in </button>
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

{#snippet keyboard()}
  <div class="card">
    <div class="orden-setting setting">
      <span class="name"
        ><span class="what"
          >Shortcuts<Hint
            text="Which app’s keys Orden follows; any key below can still be changed."
          /></span
        ></span
      >
      <div class="orden-setting-value">
        <Select
          value={shortcuts.preset}
          options={presetChoices}
          onchange={(value: string) => void choosePreset(value)}
          label="Shortcuts"
          plain={viewport.touch}
        />
      </div>
    </div>

    {@render row({
      kind: 'switch',
      key: 'shortcuts.vim',
      label: 'Vim keys',
      hint: 'Moves and edits in notes with Vim’s keys.',
      get: () => modes.vim,
      set: (on) => modes.setVimKeys(on),
    })}
  </div>

  <label class="orden-field search">
    <svg class="orden-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
    <input
      bind:value={keyFilter}
      placeholder="Search shortcuts"
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />
  </label>

  <div class="shortcut-list" data-scrolls use:scrollbar>
    {#each keyGroups as group (group.id)}
      <section class="shortcut-group">
        <h3>{group.label}</h3>
        <div class="card">
          {#each group.rows as entry (entry.id)}
            {@const key = shortcuts.keyFor(entry.id)}
            {@const warning = entry.scope === 'fixed' ? null : shortcuts.warning(key)}
            {@const reach = noteFor(
              globalKeys.keys,
              entry.id,
              shown(key),
              accelerator(key, shortcuts.platform) !== null,
            )}
            <div class="orden-setting setting shortcut">
              <span class="name">
                <span class="what"
                  >{entry.label()}{#if entry.why}<Hint text={entry.why()} />{/if}</span
                >
                {#if entry.alias}<small>Second key</small>{/if}
                {#if warning}<small class="caution">{warning}</small>{/if}
                {#if reach}<small class="reach"
                    >{reach.text}{#if reach.change}
                      <button class="link" onclick={() => globalKeys.change()}>Change</button
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
                  title={rebind.listening === entry.id
                    ? 'Esc stops recording, Backspace takes the key away.'
                    : undefined}
                  onclick={() => rebind.listen(entry.id)}
                >
                  {rebind.listening === entry.id ? 'Press a key…' : (shown(key) ?? 'Not set')}
                </button>
                <button
                  class="orden-glyph revert"
                  disabled={!shortcuts.changed(entry.id)}
                  title="Reset"
                  aria-label="Reset"
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
                  {shown(rebind.clash.key) ?? ''} already runs {rebind.clash.holders
                    .map((one) => one.label())
                    .join(', ')}.
                </span>
                <button class="orden-chip" onclick={() => rebind.takeOver()}>Take it over</button>
                <button class="orden-chip is-quiet" onclick={() => (rebind.clash = null)}
                  >Cancel</button
                >
              </div>
            {/if}
          {/each}
        </div>
      </section>
    {:else}
      <p class="note">Nothing matches.</p>
    {/each}
  </div>

  <div class="card">
    <button class="orden-action" onclick={() => shortcuts.resetAll()}>Reset all shortcuts</button>
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
  <p class="lead">The bar sits over the keyboard on a phone.</p>

  <h3>On the bar</h3>
  <div class="card">
    {#each toolbar.ids as id, at (id)}
      <div
        class="orden-setting setting button"
        class:landing={dropAt === at}
        role="group"
        aria-label={nameFor(id)}
        draggable={!viewport.touch}
        ondragstart={(event) => takeBar(event, at)}
        use:dropOver={(event) => overBar(event, at)}
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
          class="orden-glyph revert"
          disabled={at === 0}
          title="Move up"
          aria-label="Move up"
          onclick={() => toolbar.move(at, at - 1)}
        >
          <svg viewBox="0 0 16 16"><path d="M4.5 9.5L8 6l3.5 3.5" /></svg>
        </button>
        <button
          class="orden-glyph revert"
          disabled={at === toolbar.ids.length - 1}
          title="Move down"
          aria-label="Move down"
          onclick={() => toolbar.move(at, at + 1)}
        >
          <svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
        </button>
        <button
          class="orden-glyph revert"
          title="Take it off"
          aria-label="Take it off"
          onclick={() => toolbar.remove(id)}
        >
          <Cross />
        </button>
      </div>
    {:else}
      <p class="note">Nothing on the bar.</p>
    {/each}
  </div>

  <div class="card">
    <button class="orden-action" disabled={!toolbar.changed} onclick={() => toolbar.reset()}>
      Reset the bar
    </button>
  </div>

  <h3>Everything else</h3>
  <label class="orden-field search">
    <svg class="orden-field-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
    <input
      bind:value={barFilter}
      placeholder="Search commands"
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />
  </label>

  {#each barOffers as group (group.id)}
    <h3>{group.label}</h3>
    <div class="card">
      {#each group.rows as entry (entry.id)}
        <div class="orden-setting setting button">
          {@render mark(entry.id)}
          <span class="name">{entry.label()}</span>
          <button
            class="orden-glyph revert"
            title="Put it on the bar"
            aria-label="Put it on the bar"
            onclick={() => toolbar.add(entry.id)}
          >
            <svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="note">Nothing matches.</p>
  {/each}
{/snippet}

{#snippet glassesExtras()}
  <h3>Questions</h3>
  <div class="card">
    {#if glassesKey.set && !replacingKey}
      <div class="orden-setting setting keyed">
        <span class="name"
          ><span class="what"
            >OpenAI key<Hint text="The OpenAI key the glasses ask their questions with." /></span
          ></span
        >
        <div class="row">
          <span class="hint">set, ends in …{glassesKey.tail}</span>
          <button class="orden-chip" onclick={() => (replacingKey = true)}>Replace</button>
          <button class="orden-chip is-quiet" onclick={() => void offered.remove()}>Remove</button>
        </div>
      </div>
    {:else}
      <!-- svelte-ignore a11y_autofocus -->
      <label class="orden-setting setting">
        <span class="name"
          ><span class="what"
            >OpenAI key<Hint text="The OpenAI key the glasses ask their questions with." /></span
          ></span
        >
        <input
          class="orden-field is-value"
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
      <div class="orden-setting setting">
        <span class="name"
          ><span class="what"
            >Model<Hint text="The model that answers what you ask on the glasses." /></span
          ></span
        >
        <div class="orden-setting-value">
          <Select
            value={modes.glassesModel}
            options={offered.models.map((one) => ({ value: one, label: one }))}
            onchange={(value: string) => modes.setGlassesModel(value)}
            label="Model"
            plain={viewport.touch}
          />
        </div>
      </div>
      <div class="orden-setting setting">
        <span class="name"
          ><span class="what"
            >Reasoning<Hint
              text="How long the model thinks before it answers; longer is slower."
            /></span
          ></span
        >
        <div class="orden-setting-value">
          <Select
            value={modes.glassesEffort}
            options={EFFORT_WORDS.map((one) => ({ value: one.value, label: one.label }))}
            onchange={(value: string) => modes.setGlassesEffort(value)}
            label="Reasoning"
            plain={viewport.touch}
          />
        </div>
      </div>
    {/if}
  </div>

  <p class="hint caption">
    {#if offered.said}{offered.said}{:else}Kept encrypted on your account, and never shown again.{/if}
  </p>
{/snippet}

{#snippet themeTools()}
  <div class="orden-setting setting">
    <span class="name">Themes</span>
    <button class="orden-chip" onclick={() => store.show()}>Browse</button>
  </div>

  {#if isDesktop}
    <div class="orden-setting setting">
      <span class="name">Reload themes and custom CSS</span>
      <button class="orden-chip" onclick={() => theme.reload()}>Reload</button>
    </div>
  {/if}
{/snippet}

<style>
  .sheet {
    display: grid;
    grid-template-columns: clamp(10rem, 28%, 15rem) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--surface);
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

  .item .orden-row-label {
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
    max-width: var(--screen-pair);
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

  .setting .orden-segmented {
    flex: none;
    min-width: min(var(--setting-value), 100%);
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

  .body :global(.orden-setting.landed) {
    border-radius: var(--radius-row);
    background: var(--accent-soft);
    box-shadow: 0 0 0 var(--space-2) var(--accent-soft);
  }

  .setting.shortcut {
    gap: var(--space-2);
  }

  .body.filled {
    display: flex;
    flex-direction: column;
  }

  .body.filled > .pane {
    flex: 1 0 auto;
  }

  .shortcut-list {
    flex: 1 1 0;
    min-height: 12rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .shortcut-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pane .shortcut-group h3 {
    position: sticky;
    top: 0;
    z-index: var(--z-raised);
    margin: 0;
    padding-block: var(--space-1);
    background: var(--surface);
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

  .orden-button {
    align-self: flex-start;
  }

  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .slider.floored::-webkit-slider-runnable-track {
    background:
      linear-gradient(var(--line-strong), var(--line-strong)) left / var(--least) 100% no-repeat,
      linear-gradient(var(--accent), var(--accent)) left / var(--fill) 100% no-repeat,
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
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .sheet.phone > nav,
  .sheet.phone > .body {
    flex: 1;
    min-height: 0;
  }

  .sheet.phone .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--touch-row);
    padding: 0 6px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .sheet.phone .bar h2 {
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
    overflow: clip;
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

  :global(main:has(.fab)) .sheet.phone nav,
  :global(main:has(.fab)) .sheet.phone .body {
    padding-bottom: calc(var(--space-4) + var(--touch-bottom) + var(--touch-row));
  }

  .sheet.phone .pane {
    gap: var(--space-4);
  }

  .sheet.phone .pane h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2)) 14px;
    font-size: 13px;
    color: var(--muted);
  }

  .sheet.phone .pane .shortcut-group h3 {
    margin: 0;
    padding-inline-start: 14px;
    background: var(--bg);
  }

  .sheet.phone .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: clip;
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
  .sheet.phone :global(.orden-action + .setting::before),
  .sheet.phone :global(.orden-action + .orden-action::before) {
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

  .sheet.phone :global(.orden-action) {
    position: relative;
    padding: var(--space-2) var(--touch-pad);
    color: var(--accent);
  }

  .sheet.phone :global(.orden-action.is-danger) {
    color: var(--danger);
  }

  .sheet.phone :global(.orden-action:active:not(:disabled)) {
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

  .sheet.phone .orden-button {
    align-self: stretch;
  }
</style>
