<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { fade, fly, scale, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { account } from './account.svelte'
  import { exportCommands } from './commands'
  import { domainNotice } from './domain-status'
  import { message, t } from './i18n.svelte'
  import McpSetup from './McpSetup.svelte'
  import RecentlyDeleted from './RecentlyDeleted.svelte'
  import { ORIENTATIONS, PAPER_SIZES } from './page-setup'
  import { scrollbar } from './scrollbar'
  import Select from './Select.svelte'
  import { settings, type Section } from './settings.svelte'
  import { CATEGORIES, SHORTCUTS, shortcuts } from './shortcuts.svelte'
  import { PRESETS } from './shortcuts/presets'
  import { showCombination } from './keys'
  import { prompt } from './prompt.svelte'
  import { Publishing, relativeToSpace } from './settings/publishing.svelte'
  import { Rebind } from './settings/rebind.svelte'
  import { ICONS, sectionGroups } from './settings/sections'
  import { type Place, search } from './settings-search'
  import { sync } from './sync.svelte'
  import { isDesktop } from './tauri'
  import { theme } from './theme.svelte'
  import ThemeStore from './ThemeStore.svelte'
  import { store } from './themes/store.svelte'
  import { type Field, preferences, resetPane, resettable } from './preferences'
  import { readableSize, usage } from './usage.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'

  const { view }: { view?: EditorView | undefined } = $props()

  const GROUPS = $derived(sectionGroups())

  const SECTIONS = $derived(GROUPS.flat())
  const titleOf = (id: Section) => SECTIONS.find((one) => one.id === id)?.label ?? ''

  let query = $state('')

  /** The generated panes, rebuilt as things change so every control shows the
   *  value it actually has. */
  const panes = $derived(preferences(view))
  const current = $derived(panes.find((one) => one.id === settings.section))

  /** Page setup is only worth anything next to the buttons that use it. */
  const exportActions = () =>
    exportCommands().filter((command) => command.id !== 'page-setup' && command.id !== 'import')

  /** What the hand-written panes show, so search can land on those too. */
  const places = $derived.by((): Place[] => {
    const all: Place[] = [
      { section: 'account', label: t('Display name'), text: [t('Shown on anything you publish.')] },
      { section: 'account', label: t('Email'), text: [account.user?.email ?? ''] },
      { section: 'account', label: t('Storage'), text: [] },
      { section: 'account', label: account.signedIn ? t('Sign out') : t('Sign in'), text: [] },
      { section: 'appearance', label: t('Themes'), text: [t('Browse'), t('Install')] },
      {
        section: 'export',
        label: t('Page'),
        text: [
          t('Paper'),
          t('Orientation'),
          t('Margin'),
          t('Header'),
          t('Footer'),
          t('Appearance'),
        ],
      },
      { section: 'editor', label: t('Reset to defaults'), text: [] },
      // Every shortcut by name, so searching the settings for "Bold" lands on
      // the key that runs it as well as on the button that does.
      ...SHORTCUTS.map((one): Place => ({
        section: 'shortcuts',
        label: one.label(),
        text: [shortcuts.hint(one.id) ?? '', t('Shortcuts')],
      })),
      { section: 'markdown', label: t('Reset to defaults'), text: [] },
      ...exportActions().map((action): Place => ({
        section: 'export',
        label: action.label,
        text: [],
      })),
    ]

    if (!theme.accentIsTheme) {
      all.push({
        section: 'appearance',
        label: t('Accent'),
        text: theme.accents.map((one) => t(one.name)),
      })
    }

    if (isDesktop) {
      all.push({
        section: 'appearance',
        label: t('Reload themes and custom CSS'),
        text: [t('Custom')],
      })
    }

    if (account.signedIn) {
      all.push(
        {
          section: 'publish',
          label: t('Publish'),
          text: [t('What to publish'), t('Address'), 'blog'],
        },
        { section: 'publish', label: t('Your own domain'), text: ['domain', 'dns'] },
        {
          section: 'llm',
          label: t('LLM access'),
          text: ['MCP', 'Claude', 'ChatGPT', 'token', t('Connect'), t('Create a token')],
        },
      )
    }

    // The pane's own name counts as a word on everything in it.
    return all.map((place) => ({ ...place, text: [...place.text, titleOf(place.section)] }))
  })

  /** Searching looks across every pane at once: nobody knows which one holds
   *  the thing they are after, which is the reason for the box. */
  const found = $derived(search(query, panes, places))

  // Signing out while one of them is open would leave a pane with nothing in it.
  $effect(() => {
    if (!SECTIONS.some((one) => one.id === settings.section)) settings.section = 'account'
  })

  // The theme store is a sheet over this one, so closing this one closes it too:
  // it would otherwise be waiting there the next time the settings opened.
  $effect(() => {
    if (!settings.open) store.close()
  })

  /** Opens a pane: from the list, from the search results, from anywhere. */
  function go(section: Section) {
    query = ''
    settings.section = section
    settings.listing = false
  }

  const publishing = new Publishing()

  const blog = $derived(settings.remote?.blog)
  /** A domain of one's own needs Cloudflare for SaaS on the shared zone, which
   *  is not enabled; a domain entered today would wait forever. So the choice
   *  is only shown where a space already has a domain (set by hand, served by
   *  a route of its own), and everyone else sees the shared name alone. */
  const offerDomain = $derived(!!blog?.domain)
  const published = $derived(!!blog?.enabled)
  /** Wherever the blog answers, for the link under the button. */
  const liveAt = $derived(
    blog?.domain ?? (blog?.subdomain ? `${blog.subdomain}.nibeditor.com` : ''),
  )
  /** The records for a domain: fresh from publishing, or as the listing
   *  remembers them. */
  const records = $derived(settings.dns.length ? settings.dns : (blog?.dns ?? []))
  /** What is happening with the domain, once the server has been asked. */
  const notice = $derived(settings.domain ? domainNotice(settings.domain) : null)

  $effect(() => {
    if (!settings.open) return
    publishing.fill(blog)
    publishing.confirmed = published
  })

  // Asked after while the pane shows a domain, and left alone as soon as it
  // does not: the timer would otherwise keep going behind a closed panel.
  $effect(() => {
    if (!settings.open || settings.section !== 'publish' || !blog?.domain) return
    void settings.watchDomain()
    return () => settings.stopWatchingDomain()
  })

  /** The entry goes in Windows Explorer's own registry, so a browser cannot
   *  offer it however Windows the machine running the browser happens to be. */
  const isWindows = isDesktop && navigator.userAgent.includes('Windows')

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  const noteChoices = $derived([
    { value: '', label: t('The whole space') },
    ...workspace.notes.map((note) => ({
      value: relativeToSpace(note.path),
      label: t('Only {name}', { name: stripped(note.name) }),
    })),
  ])

  async function rename(name: string) {
    settings.error = null
    try {
      await account.rename(name)
    } catch (error) {
      settings.error = message(error, 'that did not work')
    }
  }

  /** Where a slider's thumb sits, for the filled part of its track. */
  const fraction = (field: Extract<Field, { kind: 'slider' }>) =>
    ((field.get() - field.min) / (field.max - field.min)) * 100

  // ── Shortcuts ───────────────────────────────────────────────────

  const rebind = new Rebind()
  let keyFilter = $state('')

  const shown = (key: string | null) => (key ? showCombination(key, shortcuts.platform) : null)

  /** The keyboards to choose from. Custom is in the list only while it is what
   *  the map is: it is arrived at by rebinding a key, never chosen, and an
   *  option that does nothing is worse than one that is not there. */
  const presetChoices = $derived([
    ...PRESETS.map((one) => ({ value: one.id, label: one.label() })),
    ...(shortcuts.preset === 'custom' ? [{ value: 'custom', label: t('Custom') }] : []),
  ])

  /** Handing the whole keyboard over throws away a map somebody made by hand,
   *  so that one case asks first. Choosing between two presets replaces
   *  nothing anybody wrote and goes straight through. */
  async function choosePreset(id: string) {
    if (shortcuts.preset === 'custom') {
      const sure = await prompt.confirm({
        title: t('Replace your own keys?'),
        detail: t('The keys you changed go back to what this keyboard says.'),
        confirmLabel: t('Replace'),
      })
      if (!sure) return
    }

    shortcuts.choose(id)
  }

  /** The list, grouped the way the menus group the same commands, and cut
   *  down to what was typed in the box above it. A shortcut is looked for by
   *  its name or by the key it is on, so both count. */
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

  /** The next keystroke goes to whichever row is listening.
   *
   *  On the way down rather than up, and before anything else sees it: the
   *  app's own keys are on the window too, and Ctrl+S while recording is a key
   *  being chosen, not a note being saved. */
  $effect(() => {
    if (!rebind.listening) return

    const record = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      rebind.record(event)
    }

    window.addEventListener('keydown', record, true)
    return () => window.removeEventListener('keydown', record, true)
  })

  // Nothing is left listening behind a closed panel or a pane that moved on.
  $effect(() => {
    if (!settings.open || settings.section !== 'shortcuts') rebind.forget()
  })

  /** A window that grows into place on a desktop; a page that rises from the
   *  bottom on a phone. */
  function appear(node: Element) {
    return viewport.phone
      ? fly(node, { y: 40, duration: 240, easing: cubicOut })
      : scale(node, { duration: 200, start: 0.97, easing: cubicOut })
  }

  /** The list and the pane slide past each other on a phone; a desktop shows
   *  both and has nothing to slide. */
  const enter = (x: number) =>
    viewport.phone ? { x, duration: 200, easing: cubicOut } : { duration: 0 }

  // Back closes this before it leaves the app: the pane first, then the sheet.
  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (settings.open ? overlays.show(() => (settings.open = false)) : undefined))
  $effect(() => closeOnBack(settings.open, () => (settings.open = false)))
  $effect(() => closeOnBack(settings.open && !settings.listing, () => (settings.listing = true)))
</script>

{#if settings.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="scrim"
    transition:fade={{ duration: 140 }}
    onclick={() => (settings.open = false)}
  ></div>

  <div class="sheet" class:phone={viewport.phone} transition:appear>
    {#if viewport.phone}
      <header class="bar">
        {#if !settings.listing}
          <button class="icon" aria-label={t('Back')} onclick={() => (settings.listing = true)}>
            <svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>
          </button>
        {/if}

        <h1 class:inset={settings.listing}>
          {settings.listing ? t('Settings') : titleOf(settings.section)}
        </h1>

        <button class="icon" aria-label={t('Close')} onclick={() => (settings.open = false)}>
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>
    {/if}

    {#if !viewport.phone || settings.listing}
      <nav data-scrolls use:scrollbar in:fly={enter(-24)}>
        {#if !viewport.phone}
          <h1>{t('Settings')}</h1>
        {/if}

        <label class="search">
          <svg viewBox="0 0 16 16"
            ><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg
          >
          <input bind:value={query} placeholder={t('Search settings')} spellcheck="false" />
        </label>

        {#if viewport.phone && query}
          {@render results()}
        {:else}
          {#each GROUPS as group, index (index)}
            <div class="group">
              {#each group as item (item.id)}
                <button
                  class="item"
                  class:active={!viewport.phone && !query && settings.section === item.id}
                  onclick={() => go(item.id)}
                >
                  <svg class="glyph" viewBox="0 0 16 16"><path d={ICONS[item.id]} /></svg>
                  <span class="text">{item.label}</span>
                  <svg class="chevron" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg>
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </nav>
    {/if}

    {#if !viewport.phone || !settings.listing}
      <div class="body" data-scrolls use:scrollbar={settings.section} in:fly={enter(24)}>
        {#if query && !viewport.phone}
          <div class="pane">
            <h2>{t('Search settings')}</h2>
            {@render results()}
          </div>
        {:else}
          {#key settings.section}
            <div
              class="pane"
              in:fly={viewport.phone ? { duration: 0 } : { y: 8, duration: 180, easing: cubicOut }}
            >
              {#if !viewport.phone}
                <h2>{titleOf(settings.section)}</h2>
              {/if}
              {@render pane()}
            </div>
          {/key}
        {/if}

        {#if settings.error}
          <p class="hint bad" transition:slide={{ duration: 160 }}>{t(settings.error)}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- The theme store, over this sheet and only ever reached from it. -->
  <ThemeStore />
{/if}

<!-- What search turned up: each setting with its own control, captioned with
     the pane it lives in, and the things search can only point at. -->
{#snippet results()}
  {#if found.length}
    <div class="card">
      {#each found as hit, index (index)}
        {#if hit.kind === 'field'}
          {@render row(hit.field, hit.pane.label)}
        {:else}
          <button class="setting link" onclick={() => go(hit.section)}>
            <span class="name">{hit.label}<small>{titleOf(hit.section)}</small></span>
            <svg class="chevron" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/if}
{/snippet}

<!-- One row per setting, whatever kind it is. -->
{#snippet row(field: Field, where?: string)}
  {#if field.kind === 'switch'}
    <!-- The whole row is the switch, so there is nothing to miss. -->
    <button
      class="setting"
      role="switch"
      aria-checked={field.get()}
      onclick={() => field.set(!field.get())}
    >
      <span class="name"
        >{field.label}{#if where}<small>{where}</small>{/if}</span
      >
      <span class="toggle" class:on={field.get()} aria-hidden="true"></span>
    </button>
  {:else if field.kind === 'slider'}
    <div class="setting sliding">
      <span class="name"
        >{field.label}{#if where}<small>{where}</small>{/if}</span
      >
      <span class="value">{field.get()}{field.unit ?? ''}</span>
      <input
        class="slider"
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={field.get()}
        aria-label={field.label}
        style:--fill="{fraction(field)}%"
        oninput={(event) => field.set(Number(event.currentTarget.value))}
      />
    </div>
  {:else}
    <div class="setting">
      <span class="name"
        >{field.label}{#if where}<small>{where}</small>{/if}</span
      >
      <div class="pick">
        <Select
          value={field.get()}
          options={field.options}
          onchange={(value: string) => field.set(value)}
          label={field.label}
          plain={viewport.phone}
        />
      </div>
    </div>
  {/if}
{/snippet}

{#snippet pane()}
  {#if current}
    {#each current.groups as group (group.title)}
      <h3>{group.title}</h3>
      <div class="card">
        {#each group.fields as field (field.label)}
          {@render row(field)}
        {/each}
      </div>
    {/each}

    {#if settings.section === 'appearance'}
      {@render appearanceExtras()}
    {/if}

    <!-- Everything above, back to how it came. -->
    {#if resettable(current)}
      <div class="card">
        <button class="action" onclick={() => resetPane(current)}>{t('Reset to defaults')}</button>
      </div>
    {/if}
  {:else if settings.section === 'account'}
    {#if account.signedIn}
      <h3>{t('Account')}</h3>
      <div class="card">
        <label class="setting">
          <span class="name">{t('Display name')}</span>
          <input
            class="inline"
            value={account.user?.name ?? ''}
            placeholder={t('Your name')}
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
        <div class="setting">
          <span class="name">{t('Email')}</span>
          <span class="text">{account.user?.email}</span>
        </div>
      </div>
      <p class="hint caption">{t('Shown on anything you publish.')}</p>

      <!-- Notes and images together, which is what the limit counts. Having
           an account is what syncing means, so there is nothing to switch:
           the pane only says where things stand. -->
      <h3>{t('Storage')}</h3>
      <div class="card">
        <div class="stack">
          <div
            class="meter"
            class:full={usage.nearlyFull}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={usage.used}
          >
            <div class="fill" style:width="{Math.min(100, usage.fraction * 100)}%"></div>
          </div>
          <p class="hint">
            {t('{used} of {limit} used.', {
              used: readableSize(usage.used),
              limit: readableSize(usage.limit),
            })}
          </p>
          <p class="hint">
            {t('{count} spaces sync to your account.', { count: workspace.spaces.length })}
            {#if sync.lastSyncedAt}
              {t('Last synced {time}.', {
                time: new Date(sync.lastSyncedAt).toLocaleTimeString(),
              })}
            {/if}
          </p>
        </div>
      </div>

      <div class="card">
        <button class="action danger" onclick={() => account.signOut()}>{t('Sign out')}</button>
      </div>
    {:else}
      <p class="lead">{t('Not signed in')}</p>
      <button
        class="primary"
        onclick={() => {
          settings.open = false
          account.open = true
        }}
      >
        {t('Sign in')}
      </button>
    {/if}
  {:else if settings.section === 'publish'}
    {#if !settings.remote}
      <p class="note">{t('Sign in first, from Account.')}</p>
    {:else}
      <!-- The consequence comes before the switch, not after it. -->
      <label class="danger-check">
        <input type="checkbox" bind:checked={publishing.confirmed} disabled={published} />
        <span>
          <strong>{t('Everything in this space becomes public.')}</strong>
          {t('Every note, including drafts, is readable by anyone with the address.')}
        </span>
      </label>

      <fieldset disabled={!publishing.confirmed}>
        <div class="card">
          <div class="setting">
            <span class="name">{t('What to publish')}</span>
            <div class="pick wide">
              <Select
                value={publishing.note}
                options={noteChoices}
                onchange={(value: string) => {
                  publishing.note = value
                }}
                label={t('What to publish')}
                plain={viewport.phone}
              />
            </div>
          </div>
        </div>

        <!-- One address or the other. The choice is the control, so there is
             no way to end up asking for both. -->
        <h3>{t('Address')}</h3>
        {#if offerDomain}
          <div class="segmented" role="radiogroup" aria-label={t('Address')}>
            <button
              type="button"
              role="radio"
              aria-checked={publishing.address === 'subdomain'}
              class:on={publishing.address === 'subdomain'}
              onclick={() => (publishing.address = 'subdomain')}
            >
              {t('On nibeditor.com')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={publishing.address === 'domain'}
              class:on={publishing.address === 'domain'}
              onclick={() => (publishing.address = 'domain')}
            >
              {t('Your own domain')}
            </button>
          </div>
        {/if}

        {#if !offerDomain || publishing.address === 'subdomain'}
          <div class="card">
            <div class="stack">
              <div class="row">
                <input
                  value={publishing.subdomain}
                  oninput={(event) => publishing.typeSubdomain(event.currentTarget.value)}
                  placeholder="your-name"
                  spellcheck="false"
                  autocapitalize="off"
                />
                <span class="suffix">.nibeditor.com</span>
              </div>
              {#if settings.availability.checking}
                <span class="hint">{t('checking…')}</span>
              {:else if settings.availability.available === true}
                <span class="hint ok">{t('available')}</span>
              {:else if settings.availability.available === false}
                <span class="hint bad">{t(settings.availability.reason ?? '')}</span>
              {/if}
              {#if published && blog?.domain}
                <span class="hint">{t('Switching gives up {name}.', { name: blog.domain })}</span>
              {/if}
            </div>
          </div>
        {:else}
          <div class="card">
            <div class="stack">
              <input
                bind:value={publishing.domain}
                placeholder="notes.example.com"
                spellcheck="false"
                autocapitalize="off"
              />
              {#if published && blog?.subdomain}
                <span class="hint">
                  {t('Switching gives up {name}.', { name: `${blog.subdomain}.nibeditor.com` })}
                </span>
              {/if}
              {#if records.length}
                <div class="scrolls">
                  <table class="dns">
                    <thead>
                      <tr><th>{t('Type')}</th><th>{t('Name')}</th><th>{t('Value')}</th></tr>
                    </thead>
                    <tbody>
                      {#each records as record (record.name + record.type)}
                        <tr>
                          <td>{record.type}</td>
                          <td>{record.name}</td>
                          <td>{record.value}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
                {#each records as record (record.name + record.type)}
                  {#if record.note}
                    <span class="hint">{t(record.note)}</span>
                  {/if}
                {/each}
                <span class="hint">
                  {t('Add this at your registrar. It is checked every few seconds.')}
                </span>
              {/if}
              {#if notice}
                <span
                  class="hint"
                  class:ok={notice.tone === 'ok'}
                  class:bad={notice.tone === 'bad'}
                >
                  {t(notice.text)}
                  {#if notice.detail}{t(notice.detail)}{/if}
                </span>
              {/if}
            </div>
          </div>
        {/if}

        <button class="primary" disabled={!publishing.ready} onclick={() => publishing.publish()}>
          {published ? t('Update') : t('Publish')}
        </button>
      </fieldset>

      {#if published && liveAt}
        <p class="note" transition:slide={{ duration: 180 }}>
          {t('Live at')}
          <a href="https://{liveAt}" target="_blank" rel="noreferrer">{liveAt}</a>
        </p>
        <div class="card">
          <button class="action danger" onclick={() => settings.unpublish()}>
            {t('Stop publishing')}
          </button>
        </div>
      {/if}
    {/if}
  {:else if settings.section === 'shortcuts'}
    {@render keyboard()}
  {:else if settings.section === 'llm'}
    <!-- Its own component: the pane is a small guide, not a list of settings. -->
    <McpSetup />
  {:else if settings.section === 'trash'}
    <RecentlyDeleted />
  {:else if settings.section === 'export'}
    <h3>{t('Page')}</h3>
    <div class="card">
      <div class="setting">
        <span class="name">{t('Paper')}</span>
        <div class="pick">
          <Select
            value={settings.page.paper}
            options={PAPER_SIZES.map((size) => ({ value: size, label: size }))}
            onchange={(value) => settings.setPage({ paper: value as never })}
            label={t('Paper')}
            plain={viewport.phone}
          />
        </div>
      </div>
      <div class="setting">
        <span class="name">{t('Orientation')}</span>
        <div class="pick">
          <Select
            value={settings.page.orientation}
            options={ORIENTATIONS.map((option) => ({ value: option, label: t(option) }))}
            onchange={(value) => settings.setPage({ orientation: value as never })}
            label={t('Orientation')}
            plain={viewport.phone}
          />
        </div>
      </div>
      <label class="setting">
        <span class="name">{t('Margin')}</span>
        <input
          class="inline"
          value={settings.page.margin}
          oninput={(event) => settings.setPage({ margin: event.currentTarget.value })}
          spellcheck="false"
        />
      </label>
      <!-- Running text on every sheet. `${title}`, `${date}` and `${year}`
           are filled in; the hint shows the shape. -->
      <label class="setting">
        <span class="name">{t('Header')}</span>
        <input
          class="inline"
          value={settings.page.header}
          placeholder="&#36;{'{'}title}"
          oninput={(event) => settings.setPage({ header: event.currentTarget.value })}
          spellcheck="false"
        />
      </label>
      <label class="setting">
        <span class="name">{t('Footer')}</span>
        <input
          class="inline"
          value={settings.page.footer}
          placeholder="&#36;{'{'}date}"
          oninput={(event) => settings.setPage({ footer: event.currentTarget.value })}
          spellcheck="false"
        />
      </label>
      <div class="setting">
        <span class="name">{t('Appearance')}</span>
        <div class="pick">
          <Select
            value={settings.exportAppearance}
            options={[
              { value: 'light', label: t('Light') },
              { value: 'dark', label: t('Dark') },
              { value: 'app', label: t('Match the app') },
            ]}
            onchange={(value) => settings.setExportAppearance(value as never)}
            label={t('Appearance')}
            plain={viewport.phone}
          />
        </div>
      </div>
    </div>

    <!-- The settings above only matter once something is exported, so the
         ways of doing it belong here rather than in the palette. -->
    <h3>{t('This note')}</h3>
    <div class="card">
      {#each exportActions() as action (action.id)}
        <button class="action" disabled={action.disabled} onclick={action.run}>
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<!-- Every shortcut there is, grouped the way the menus group the same
     commands. A row is its name, the key it is on, and a way back to the key
     it started on; the ones that cannot be changed say why instead. -->
{#snippet keyboard()}
  <!-- Whose keyboard this is, before the list of what is on it. -->
  <div class="card">
    <div class="setting">
      <span class="name">{t('Shortcuts')}</span>
      <div class="pick">
        <Select
          value={shortcuts.preset}
          options={presetChoices}
          onchange={(value: string) => void choosePreset(value)}
          label={t('Shortcuts')}
          plain={viewport.phone}
        />
      </div>
    </div>
  </div>

  <label class="search">
    <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg>
    <input bind:value={keyFilter} placeholder={t('Search shortcuts')} spellcheck="false" />
  </label>

  {#each keyGroups as group (group.id)}
    <h3>{group.label}</h3>
    <div class="card">
      {#each group.rows as entry (entry.id)}
        {@const key = shortcuts.keyFor(entry.id)}
        {@const warning = entry.scope === 'fixed' ? null : shortcuts.warning(key)}
        <div class="setting shortcut">
          <span class="name">
            {entry.label()}
            {#if entry.alias}<small>{t('Second key')}</small>{/if}
            {#if entry.why}<small>{entry.why()}</small>{/if}
            {#if warning}<small class="caution">{warning}</small>{/if}
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
              class="revert"
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
          <div class="clash" transition:slide={{ duration: 160 }}>
            <span>
              {t('{key} already runs {name}.', {
                key: shown(rebind.clash.key) ?? '',
                name: rebind.clash.holders.map((one) => one.label()).join(', '),
              })}
            </span>
            <button class="take" onclick={() => rebind.takeOver()}>{t('Take it over')}</button>
            <button class="give" onclick={() => (rebind.clash = null)}>{t('Cancel')}</button>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/each}

  <p class="hint">{t('Esc stops recording, Backspace takes the key away.')}</p>

  <div class="card">
    <button class="action" onclick={() => shortcuts.resetAll()}>{t('Reset all shortcuts')}</button>
  </div>
{/snippet}

{#snippet appearanceExtras()}
  <!-- Under the theme it belongs to, without a heading of its own: it is another
       way of choosing the same thing. Nowhere else in the app says there is a
       store, so nobody who never opens it ever hears about it. -->
  <div class="card">
    <div class="setting">
      <span class="name">{t('Themes')}</span>
      <button class="pill" onclick={() => store.show()}>{t('Browse')}</button>
    </div>
  </div>

  <!-- A theme that brought an accent of its own keeps it, so the row would be a
       row of swatches that change nothing. Left out rather than left dead. -->
  {#if !theme.accentIsTheme}
    <h3>{t('Accent')}</h3>
    <div class="card">
      <div class="accents">
        {#each theme.accents as swatch (swatch.id)}
          <button
            class="swatch"
            class:active={theme.accent === swatch.id}
            title={t(swatch.name)}
            aria-label={t(swatch.name)}
            aria-pressed={theme.accent === swatch.id}
            style:--swatch={swatch[theme.current]}
            onclick={() => theme.setAccent(swatch.id)}
          ></button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Theme files and custom.css live in a folder, which only a desktop has. -->
  {#if isDesktop}
    <h3>{t('Custom')}</h3>
    <div class="card">
      <button class="action" onclick={() => theme.reload()}
        >{t('Reload themes and custom CSS')}</button
      >

      {#if isWindows}
        {@render row({
          kind: 'switch',
          label: t('Show in Explorer’s New menu'),
          get: () => settings.newMenu,
          set: (on) => void settings.setNewMenu(on),
        })}
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 40;
  }

  .sheet {
    position: fixed;
    top: 10vh;
    left: 50%;
    translate: -50% 0;
    width: min(56rem, calc(100vw - 3rem));
    height: 76vh;
    z-index: 41;
    /* Two columns: the list of panes, and the pane. */
    display: grid;
    grid-template-columns: 14rem 1fr;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  /* ── The list of panes ─────────────────────────────────────────── */

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-4) var(--space-3);
    border-right: 1px solid var(--line);
    background: var(--bg);
    overflow-y: auto;
  }

  nav h1 {
    margin: 0 0 var(--space-3);
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 620;
    color: var(--text-strong);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin-bottom: var(--space-3);
    padding: 0 10px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .search:focus-within {
    border-color: var(--accent);
  }

  .search svg {
    width: 13px;
    height: 13px;
    flex: none;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .group + .group {
    margin-top: var(--space-2);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .item:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }

  .item.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .item .text {
    flex: 1;
    min-width: 0;
  }

  .item .glyph {
    width: 15px;
    height: 15px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A chevron means "there is a page behind this", which only a phone has. */
  .item .chevron {
    display: none;
  }

  /* ── The pane ──────────────────────────────────────────────────── */

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
    font-weight: 620;
    color: var(--text-strong);
  }

  .pane h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }

  .pane h3:first-child,
  .pane h2 + h3 {
    margin-top: 0;
  }

  /* A run of rows. Plain on a desktop; a phone draws the box around it. */
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

  /* Name on the left, control on the right, one line each. */
  .setting {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 38px;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
  }

  .setting .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .setting .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .setting .text {
    color: var(--muted-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .setting .value {
    flex: none;
    width: 4.5rem;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
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

  /* Wide enough for the longest choice any pane offers, so a value is read
     rather than guessed from its first half. */
  .pick {
    flex: none;
    width: 14rem;
  }

  .pick.wide {
    width: 18rem;
    max-width: 100%;
  }

  /* A button that is a row: it shows what it does when pointed at. */
  @media (hover: hover) {
    button.setting:hover {
      color: var(--text-strong);
    }
  }

  button.setting:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* An action in a card: full width, quiet until pointed at. */
  .action {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    text-align: left;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .action:hover:not(:disabled) {
      color: var(--text-strong);
    }

    .action.danger:hover:not(:disabled) {
      color: var(--danger);
    }
  }

  .action:disabled {
    opacity: 0.5;
  }

  /* A small action at the end of a row, where the control would be. Quiet
     until pointed at, like every other action in a pane. */
  .pill {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .pill:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .pill:active {
    background: var(--accent-soft);
  }

  /* ── A shortcut and its key ────────────────────────────────────── */

  .setting.shortcut {
    gap: var(--space-2);
  }

  /* The key itself is the button that changes it: nothing else to aim at,
     and what it shows now is what it will show after. */
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
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Listening: the ring says the next keystroke goes in here rather than
     wherever it usually goes. */
  .key.listening {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .key.none {
    color: var(--muted);
  }

  /* A key that cannot be changed is written down but is not a button. */
  .key.held {
    background: none;
    color: var(--muted);
  }

  /* Back to the key it came with. Present only once it is not on it, so the
     row stays quiet until something was actually changed. */
  .revert {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .revert:disabled {
    visibility: hidden;
  }

  @media (hover: hover) {
    .revert:hover:not(:disabled) {
      color: var(--text-strong);
    }
  }

  .revert svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* What is in the way, and the two ways out of it. Nothing is written until
     one of them is pressed. */
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

  .clash button {
    flex: none;
    padding: 5px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
  }

  .clash .take {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  /* A key that may never arrive. Softened rather than red: on a browser
     several of the defaults carry one of these, and a column of alarms about
     something nobody has done yet reads as breakage. */
  .setting .name small.caution {
    color: color-mix(in srgb, var(--danger) 55%, var(--muted));
  }

  /* A key that was turned down, which is an answer to something the reader
     just did and belongs in the colour of a refusal. */
  .setting .name small.warn {
    color: var(--danger);
  }

  .toggle {
    flex: none;
    width: 38px;
    height: 22px;
    border-radius: 99px;
    background: var(--surface-3);
    position: relative;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--muted-strong);
    transition:
      transform var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .toggle.on {
    background: var(--accent);
  }

  .toggle.on::after {
    background: #fff;
    transform: translateX(16px);
  }

  /* Drawn by hand, so it matches the switch beside it on every platform: a
     thin track filled to the value, and a thumb that reads as one. */
  .slider {
    flex: none;
    width: 11rem;
    height: 24px;
    margin: 0;
    padding: 0;
    appearance: none;
    background: none;
    cursor: default;
  }

  .slider:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 99px;
  }

  .slider::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background:
      linear-gradient(var(--accent), var(--accent)) 0 / var(--fill) 100% no-repeat,
      var(--surface-3);
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border: none;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.12),
      0 1px 3px rgb(0 0 0 / 0.35);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .slider:active::-webkit-slider-thumb {
    transform: scale(1.12);
  }

  .slider::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }

  .slider::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: var(--accent);
  }

  .slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.12),
      0 1px 3px rgb(0 0 0 / 0.35);
  }

  .lead {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-strong);
    font-weight: 550;
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .note a {
    color: var(--accent);
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  /* Under the card it explains, closer to it than the next group. */
  .hint.caption {
    margin-top: calc(-1 * var(--space-2));
  }

  .hint.ok {
    color: var(--success);
  }

  .hint.bad {
    color: var(--danger);
  }

  button.primary {
    align-self: flex-start;
    padding: 9px 14px;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button.primary {
    background: var(--accent);
    color: #fff;
  }

  @media (hover: hover) {
    button.primary:hover:not(:disabled) {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
  }

  button:disabled {
    opacity: 0.5;
  }

  /* The warning reads as a warning, and gates the controls behind it. */
  .danger-check {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--line));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--danger) 7%, transparent);
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--muted-strong);
  }

  .danger-check strong {
    display: block;
    color: var(--text-strong);
  }

  .danger-check input {
    flex: none;
    margin-top: 3px;
    accent-color: var(--accent);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  fieldset:disabled {
    opacity: 0.4;
  }

  fieldset h3 {
    margin-top: 0;
  }

  /* Two choices that cannot both be on: one control with two halves. */
  .segmented {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .segmented button {
    flex: 1;
    padding: 7px 10px;
    border: none;
    border-radius: calc(var(--radius-md) - 3px);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .segmented button.on {
    background: var(--surface);
    color: var(--text-strong);
    box-shadow: var(--shadow-sm);
  }

  .segmented button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }

  .row input,
  .stack > input {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .row input:focus,
  .stack > input:focus {
    border-color: var(--accent);
  }

  /* An input in a row: the value at the right, no box until it is typed in. */
  .inline {
    flex: none;
    width: 12rem;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: right;
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .inline::placeholder {
    color: var(--muted);
  }

  @media (hover: hover) {
    .inline:hover {
      border-color: var(--line);
    }
  }

  .inline:focus {
    border-color: var(--accent);
    background: var(--bg);
  }

  .suffix {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .scrolls {
    width: 100%;
    overflow-x: auto;
  }

  .dns {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .dns th,
  .dns td {
    border: 1px solid var(--line);
    padding: 5px 7px;
    text-align: left;
    white-space: nowrap;
  }

  .dns th {
    background: var(--surface-2);
    color: var(--muted);
    font-weight: 500;
  }

  .accents {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    cursor: default;
    /* Only the swatch under the pointer moves, and it moves plainly. The ring
       marking the chosen one is a state rather than a movement, so it is left
       out of the transition: it should appear, not grow. */
    transition: transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .swatch:hover {
      transform: scale(1.12);
    }
  }

  /* A ring rather than a tick: the colour is the whole point of the control. */
  .swatch.active {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--swatch);
  }

  .meter {
    height: 8px;
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 99px;
    background: var(--accent);
    transition: width var(--dur-base) var(--ease-out);
  }

  .meter.full .fill {
    background: var(--danger);
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  /* A page, not a window: the list of panes first, and the pane chosen from
     it sliding in over it, with its own header to come back by. Everything
     is grouped into inset cards and sized for a thumb. */
  @media (max-width: 720px) {
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

    .bar {
      display: flex;
      align-items: center;
      gap: 2px;
      height: calc(52px + env(safe-area-inset-top));
      padding: env(safe-area-inset-top) 6px 0;
      border-bottom: 1px solid var(--line);
      background: var(--bg);
    }

    .bar h1 {
      flex: 1;
      min-width: 0;
      margin: 0;
      font-family: var(--font-ui);
      font-size: 17px;
      font-weight: 620;
      color: var(--text-strong);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Without a back button before it, the title lines up with the cards. */
    .bar h1.inset {
      padding-left: 10px;
    }

    .bar .icon {
      flex: none;
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      padding: 0;
      border: none;
      border-radius: var(--radius-md);
      background: none;
      color: var(--text);
      cursor: default;
    }

    .bar .icon:active {
      background: var(--surface-2);
    }

    .bar .icon svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    nav {
      gap: 0;
      padding: var(--space-3) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom));
      border-right: none;
      background: none;
    }

    .search {
      height: 44px;
      margin-bottom: var(--space-4);
      padding: 0 14px;
      border-color: var(--line);
      border-radius: var(--radius-md);
      background: var(--surface);
    }

    .search svg {
      width: 16px;
      height: 16px;
    }

    .search input {
      /* Sixteen pixels is where iOS stops zooming into a field on focus. */
      font-size: 16px;
    }

    .group {
      gap: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      overflow: hidden;
    }

    .group + .group {
      margin-top: var(--space-4);
    }

    .item {
      position: relative;
      gap: var(--space-3);
      min-height: 52px;
      padding: 0 14px;
      border-radius: 0;
      color: var(--text);
      font-size: 15px;
    }

    /* A hairline between rows, starting where the text does. */
    .item + .item::before {
      content: '';
      position: absolute;
      top: 0;
      left: 46px;
      right: 0;
      height: 1px;
      background: var(--line);
    }

    .item:active {
      background: var(--surface-2);
    }

    .item .glyph {
      width: 20px;
      height: 20px;
      color: var(--accent);
      stroke-width: 1.2;
    }

    .item .chevron {
      display: block;
      flex: none;
      width: 16px;
      height: 16px;
      fill: none;
      stroke: var(--muted);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .body {
      padding: var(--space-3) var(--space-4) calc(var(--space-7) + env(safe-area-inset-bottom));
    }

    .pane {
      gap: var(--space-4);
    }

    .pane h3 {
      margin: var(--space-3) 0 calc(-1 * var(--space-2)) 14px;
      font-size: 13px;
      color: var(--muted);
    }

    .card {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      overflow: hidden;
    }

    .card > .stack {
      padding: 14px;
    }

    .card > .accents {
      padding: 14px;
    }

    .setting {
      position: relative;
      gap: var(--space-3);
      min-height: 52px;
      padding: 8px 14px;
      font-size: 15px;
    }

    .setting .name small {
      font-size: var(--text-sm);
    }

    .setting + .setting::before,
    .action + .setting::before,
    .action + .action::before {
      content: '';
      position: absolute;
      top: 0;
      left: 14px;
      right: 0;
      height: 1px;
      background: var(--line);
    }

    button.setting:active {
      background: var(--surface-2);
    }

    button.setting:focus-visible {
      outline-offset: -2px;
      border-radius: 0;
    }

    /* Name and value on one line, the slider full width beneath them. */
    .setting.sliding {
      flex-wrap: wrap;
      padding-bottom: 6px;
    }

    .setting .value {
      width: auto;
      font-size: var(--text-sm);
    }

    .slider {
      order: 3;
      flex: none;
      width: 100%;
      height: 32px;
    }

    .slider::-webkit-slider-thumb {
      width: 24px;
      height: 24px;
      margin-top: -10px;
    }

    .slider::-moz-range-thumb {
      width: 24px;
      height: 24px;
    }

    .pick,
    .pick.wide {
      width: auto;
      max-width: 60%;
    }

    .action {
      position: relative;
      min-height: 52px;
      padding: 8px 14px;
      color: var(--accent);
      font-size: 15px;
    }

    .action.danger {
      color: var(--danger);
    }

    .action:active:not(:disabled) {
      background: var(--surface-2);
    }

    .key {
      min-width: 5.5rem;
      padding: 7px 10px;
      font-size: var(--text-sm);
    }

    .revert {
      width: 34px;
      height: 34px;
    }

    .clash {
      padding: 10px 14px;
    }

    .toggle {
      width: 50px;
      height: 30px;
    }

    .toggle::after {
      top: 3px;
      left: 3px;
      width: 24px;
      height: 24px;
    }

    .toggle.on::after {
      transform: translateX(20px);
    }

    .inline {
      width: 55%;
      padding: 8px 10px;
      font-size: 16px;
    }

    .setting .text {
      max-width: 60%;
      font-size: 15px;
    }

    .row input,
    .stack > input {
      min-height: 46px;
      padding: 10px 12px;
      font-size: 16px;
    }

    .suffix {
      font-size: var(--text-sm);
    }

    .hint,
    .note {
      font-size: 14px;
    }

    .hint.caption {
      margin: calc(-1 * var(--space-2)) 14px 0;
    }

    .lead {
      font-size: 17px;
    }

    button.primary {
      align-self: stretch;
      min-height: 48px;
      padding: 12px 16px;
      font-size: 15px;
      text-align: center;
    }

    .danger-check {
      padding: 14px;
      border-radius: var(--radius-lg);
      font-size: 14px;
    }

    .danger-check input {
      width: 20px;
      height: 20px;
      margin-top: 1px;
    }

    .segmented button {
      min-height: 40px;
      font-size: 14px;
    }

    .accents {
      gap: 12px;
    }

    .swatch {
      width: 36px;
      height: 36px;
    }
  }
</style>
