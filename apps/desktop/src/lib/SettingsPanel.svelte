<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { fade, fly, scale, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { account } from './account.svelte'
  import { exportCommands } from './commands'
  import { domainNotice } from './domain-status'
  import { message, t } from './i18n.svelte'
  import McpSetup from './McpSetup.svelte'
  import { ORIENTATIONS, PAPER_SIZES } from './page-setup'
  import Select from './Select.svelte'
  import { settings, type Section } from './settings.svelte'
  import { type Place, search } from './settings-search'
  import { sync } from './sync.svelte'
  import { isDesktop } from './tauri'
  import { theme } from './theme.svelte'
  import { type Field, preferences, resetPane, resettable } from './preferences'
  import { readableSize, usage } from './usage.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'

  let { view }: { view?: EditorView } = $props()

  /** A line drawing each, so the list reads at a glance rather than as a
   *  column of words. */
  const ICONS: Record<string, string> = {
    // Sliders, not a sun with rays: the rail's theme button is already a sun,
    // and adjusting things is what this pane is for.
    general:
      'M2 4h2.4M7.6 4H14M2 8h4.4M9.6 8H14M2 12h6.4M11.6 12H14M4.4 4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M6.4 8a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M8.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0',
    editor: 'M2 12.6l1.6-.4 8-8a1.4 1.4 0 0 0-2-2l-8 8zM2 14.2h12',
    // A word under the checker's wavy line, with the tick it earns.
    spelling: 'M2 11.5L5.6 3l3.6 8.5M3.4 8.6h4.4M9.6 12.8l1.8 1.7 3.1-3.5',
    markdown: 'M2.5 3.5h11v9h-11zM4.5 10.5V6l2 2.4L8.5 6v4.5M10.5 6v4.5M9 9l1.5 1.5L12 9',
    appearance: 'M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.5.4-.9 1-.9h1.1a3.4 3.4 0 0 0 3.4-3.4c0-2.8-2.8-4.9-6.2-4.9zM5 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM8 5.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM11 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
    account: 'M8 8.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0',
    publish: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM1.8 8h12.4M8 1.8c1.6 1.8 2.4 3.9 2.4 6.2S9.6 12.4 8 14.2C6.4 12.4 5.6 10.3 5.6 8S6.4 3.6 8 1.8z',
    llm: 'M5 2.5h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5L5.5 14v-2.5H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
    export: 'M8 10.5V2.5M5 5.5L8 2.5l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  }

  interface Item {
    id: Section
    label: string
  }

  /** The panes, in the groups a phone shows them in: the preferences, the
   *  things an account owns, and getting a note out. Publishing and the LLM
   *  connector are both things an account owns, and both are off until
   *  deliberately turned on. Until there is an account they have nothing to
   *  show but an instruction to sign in, so they stay out of the list rather
   *  than sitting there offering nothing. */
  const GROUPS = $derived<Item[][]>([
    [
      { id: 'general', label: t('General') },
      { id: 'editor', label: t('Editor') },
      { id: 'spelling', label: t('Spelling') },
      { id: 'markdown', label: t('Markdown') },
      { id: 'appearance', label: t('Appearance') },
    ],
    [
      { id: 'account', label: t('Account') },
      ...(account.signedIn
        ? [
            { id: 'publish' as Section, label: t('Publish') },
            { id: 'llm' as Section, label: t('LLM access') },
          ]
        : []),
    ],
    [{ id: 'export', label: t('Export') }],
  ])

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
      { section: 'appearance', label: t('Accent'), text: theme.accents.map((one) => t(one.name)) },
      {
        section: 'export',
        label: t('Page'),
        text: [t('Paper'), t('Orientation'), t('Margin'), t('Header'), t('Footer'), t('Appearance')],
      },
      { section: 'editor', label: t('Reset to defaults'), text: [] },
      { section: 'markdown', label: t('Reset to defaults'), text: [] },
      ...exportActions().map((action) => ({ section: 'export' as Section, label: action.label, text: [] })),
    ]

    if (isDesktop) {
      all.push({ section: 'appearance', label: t('Reload themes and custom CSS'), text: [t('Custom')] })
    }

    if (account.signedIn) {
      all.push(
        { section: 'publish', label: t('Publish'), text: [t('What to publish'), t('Address'), 'blog'] },
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

  /** Opens a pane: from the list, from the search results, from anywhere. */
  function go(section: Section) {
    query = ''
    settings.section = section
    settings.listing = false
  }

  let subdomain = $state('')
  let domain = $state('')
  /** Which kind of address the blog is reached by. One or the other, never
   *  both: a domain of one's own replaces the shared name. */
  let mode = $state<'subdomain' | 'domain'>('subdomain')
  /** Empty means the whole space; otherwise the one note's path in it. */
  let blogNote = $state('')
  let confirmPublic = $state(false)
  let checkTimer: ReturnType<typeof setTimeout>

  const blog = $derived(settings.remote?.blog)
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
    subdomain = blog?.subdomain ?? ''
    domain = blog?.domain ?? ''
    mode = blog?.domain ? 'domain' : 'subdomain'
    blogNote = blog?.note ?? ''
    confirmPublic = published
  })

  // Asked after while the pane shows a domain, and left alone as soon as it
  // does not: the timer would otherwise keep going behind a closed panel.
  $effect(() => {
    if (!settings.open || settings.section !== 'publish' || !blog?.domain) return
    void settings.watchDomain()
    return () => settings.stopWatchingDomain()
  })

  function onSubdomain(value: string) {
    subdomain = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    clearTimeout(checkTimer)
    checkTimer = setTimeout(() => settings.checkSubdomain(subdomain), 260)
  }

  /** Only the chosen address goes up; the server lets the other one go. */
  function publish() {
    const note = blogNote || null
    void settings.publish(mode === 'subdomain' ? { subdomain, note } : { domain, note })
  }

  const canPublish = $derived(!settings.busy && (mode === 'subdomain' ? !!subdomain : !!domain))

  /** The entry goes in Windows Explorer's own registry, so a browser cannot
   *  offer it however Windows the machine running the browser happens to be. */
  const isWindows = isDesktop && navigator.userAgent.includes('Windows')

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  /** The path the server knows a note by: relative to its space, forward slashed. */
  function relativeTo(path: string): string {
    const root = workspace.activeSpace?.root ?? ''
    return path
      .slice(root.length)
      .replace(/^[\\/]+/, '')
      .replace(/\\/g, '/')
  }

  const noteChoices = $derived([
    { value: '', label: t('The whole space') },
    ...workspace.notes.map((note) => ({
      value: relativeTo(note.path),
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
  $effect(() => closeOnBack(settings.open, () => (settings.open = false)))
  $effect(() => closeOnBack(settings.open && !settings.listing, () => (settings.listing = true)))
</script>

{#if settings.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 140 }} onclick={() => (settings.open = false)}></div>

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
      <nav data-scrolls in:fly={enter(-24)}>
        {#if !viewport.phone}
          <h1>{t('Settings')}</h1>
        {/if}

        <label class="search">
          <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg>
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
      <div class="body" data-scrolls in:fly={enter(24)}>
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
      <span class="name">{field.label}{#if where}<small>{where}</small>{/if}</span>
      <span class="toggle" class:on={field.get()} aria-hidden="true"></span>
    </button>
  {:else if field.kind === 'slider'}
    <div class="setting sliding">
      <span class="name">{field.label}{#if where}<small>{where}</small>{/if}</span>
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
      <span class="name">{field.label}{#if where}<small>{where}</small>{/if}</span>
      <div class="pick">
        <Select
          value={field.get()}
          options={field.options}
          onchange={(value) => field.set(value)}
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
      <button class="primary" onclick={() => { settings.open = false; account.open = true }}>
        {t('Sign in')}
      </button>
    {/if}
  {:else if settings.section === 'publish'}
    {#if !settings.remote}
      <p class="note">{t('Sign in first, from Account.')}</p>
    {:else}
      <!-- The consequence comes before the switch, not after it. -->
      <label class="danger-check">
        <input type="checkbox" bind:checked={confirmPublic} disabled={published} />
        <span>
          <strong>{t('Everything in this space becomes public.')}</strong>
          {t('Every note, including drafts, is readable by anyone with the address.')}
        </span>
      </label>

      <fieldset disabled={!confirmPublic}>
        <div class="card">
          <div class="setting">
            <span class="name">{t('What to publish')}</span>
            <div class="pick wide">
              <Select
                value={blogNote}
                options={noteChoices}
                onchange={(value) => (blogNote = value)}
                label={t('What to publish')}
                plain={viewport.phone}
              />
            </div>
          </div>
        </div>

        <!-- One address or the other. The choice is the control, so there is
             no way to end up asking for both. -->
        <h3>{t('Address')}</h3>
        <div class="segmented" role="radiogroup" aria-label={t('Address')}>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'subdomain'}
            class:on={mode === 'subdomain'}
            onclick={() => (mode = 'subdomain')}
          >
            {t('On nibeditor.com')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'domain'}
            class:on={mode === 'domain'}
            onclick={() => (mode = 'domain')}
          >
            {t('Your own domain')}
          </button>
        </div>

        {#if mode === 'subdomain'}
          <div class="card">
            <div class="stack">
              <div class="row">
                <input
                  value={subdomain}
                  oninput={(event) => onSubdomain(event.currentTarget.value)}
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
                bind:value={domain}
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
                <span class="hint" class:ok={notice.tone === 'ok'} class:bad={notice.tone === 'bad'}>
                  {t(notice.text)}
                  {#if notice.detail}{t(notice.detail)}{/if}
                </span>
              {/if}
            </div>
          </div>
        {/if}

        <button class="primary" disabled={!canPublish} onclick={publish}>
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
  {:else if settings.section === 'llm'}
    <!-- Its own component: the pane is a small guide, not a list of settings. -->
    <McpSetup />
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
          placeholder="&#36;{'{'}title{'}'}"
          oninput={(event) => settings.setPage({ header: event.currentTarget.value })}
          spellcheck="false"
        />
      </label>
      <label class="setting">
        <span class="name">{t('Footer')}</span>
        <input
          class="inline"
          value={settings.page.footer}
          placeholder="&#36;{'{'}date{'}'}"
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

{#snippet appearanceExtras()}
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

  <!-- Theme files and custom.css live in a folder, which only a desktop has. -->
  {#if isDesktop}
    <h3>{t('Custom')}</h3>
    <div class="card">
      <button class="action" onclick={() => theme.reload()}>{t('Reload themes and custom CSS')}</button>

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

  .pick {
    flex: none;
    width: 12rem;
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
