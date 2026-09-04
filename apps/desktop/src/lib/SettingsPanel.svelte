<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { fade, fly, scale, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { MCP_URL } from './api'
  import { account } from './account.svelte'
  import { exportCommands } from './commands'
  import { t } from './i18n.svelte'
  import { ORIENTATIONS, PAPER_SIZES } from './page-setup'
  import { settings, type Section } from './settings.svelte'
  import { sync } from './sync.svelte'
  import { isDesktop } from './tauri'
  import { theme } from './theme.svelte'
  import { type Field, matches, preferences } from './preferences'
  import { readableSize, usage } from './usage.svelte'
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
    markdown: 'M2.5 3.5h11v9h-11zM4.5 10.5V6l2 2.4L8.5 6v4.5M10.5 6v4.5M9 9l1.5 1.5L12 9',
    appearance: 'M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.5.4-.9 1-.9h1.1a3.4 3.4 0 0 0 3.4-3.4c0-2.8-2.8-4.9-6.2-4.9zM5 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM8 5.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM11 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
    account: 'M8 8.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0',
    publish: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM1.8 8h12.4M8 1.8c1.6 1.8 2.4 3.9 2.4 6.2S9.6 12.4 8 14.2C6.4 12.4 5.6 10.3 5.6 8S6.4 3.6 8 1.8z',
    llm: 'M5 2.5h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5L5.5 14v-2.5H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
    export: 'M8 10.5V2.5M5 5.5L8 2.5l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  }

  /** Publishing and the LLM connector are both things an account owns, and
   *  both are off until deliberately turned on. Until there is an account they
   *  have nothing to show but an instruction to sign in, so they stay out of
   *  the list rather than sitting there offering nothing. */
  const SECTIONS = $derived(
    [
      { id: 'general' as Section, label: t('General') },
      { id: 'editor' as Section, label: t('Editor') },
      { id: 'markdown' as Section, label: t('Markdown') },
      { id: 'appearance' as Section, label: t('Appearance') },
      { id: 'account' as Section, label: t('Account') },
      ...(account.signedIn
        ? [
            { id: 'publish' as Section, label: t('Publish') },
            { id: 'llm' as Section, label: t('LLM access') },
          ]
        : []),
      { id: 'export' as Section, label: t('Export') },
    ],
  )

  let query = $state('')

  /** The generated panes, rebuilt as things change so every control shows the
   *  value it actually has. */
  const panes = $derived(preferences(view))
  const current = $derived(panes.find((one) => one.id === settings.section))

  /** Searching looks across every pane at once: nobody knows which one holds
   *  the thing they are after, which is the reason for the box. */
  const found = $derived(
    query.trim()
      ? panes.flatMap((pane) =>
          pane.groups.flatMap((group) =>
            group.fields.filter((field) => matches(field, query)).map((field) => ({ pane, field })),
          ),
        )
      : [],
  )

  // Signing out while one of them is open would leave a pane with nothing in it.
  $effect(() => {
    if (!SECTIONS.some((one) => one.id === settings.section)) settings.section = 'account'
  })

  let subdomain = $state('')
  let domain = $state('')
  /** Empty means the whole space; otherwise the one note's path in it. */
  let blogNote = $state('')
  let confirmPublic = $state(false)
  let copied = $state(false)
  let checkTimer: ReturnType<typeof setTimeout>

  const blog = $derived(settings.remote?.blog)
  const published = $derived(!!blog?.enabled)

  $effect(() => {
    if (!settings.open) return
    subdomain = blog?.subdomain ?? ''
    domain = blog?.domain ?? ''
    blogNote = blog?.note ?? ''
    confirmPublic = published
  })

  function onSubdomain(value: string) {
    subdomain = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    clearTimeout(checkTimer)
    checkTimer = setTimeout(() => settings.checkSubdomain(subdomain), 260)
  }

  /** The entry goes in Windows Explorer's own registry, so a browser cannot
   *  offer it however Windows the machine running the browser happens to be. */
  const isWindows = isDesktop && navigator.userAgent.includes('Windows')

  /** Page setup is only worth anything next to the buttons that use it. */
  const exportActions = () =>
    exportCommands().filter((command) => command.id !== 'page-setup' && command.id !== 'import')

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  /** The path the server knows a note by: relative to its space, forward slashed. */
  function relativeTo(path: string): string {
    const root = workspace.activeSpace?.root ?? ''
    return path
      .slice(root.length)
      .replace(/^[\\/]+/, '')
      .replace(/\\/g, '/')
  }

  /** What an LLM client needs to reach these notes. */
  const snippet = $derived(
    JSON.stringify(
      {
        mcpServers: {
          nib: {
            url: MCP_URL,
            headers: { Authorization: `Bearer ${settings.freshToken ?? ''}` },
          },
        },
      },
      null,
      2,
    ),
  )

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet)
    copied = true
    setTimeout(() => (copied = false), 1600)
  }

  // Back closes this before it leaves the app.
  $effect(() => closeOnBack(settings.open, () => (settings.open = false)))
</script>

{#if settings.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 140 }} onclick={() => (settings.open = false)}></div>

  <div class="sheet" transition:scale={{ duration: 200, start: 0.97, easing: cubicOut }}>
    <nav>
      <h1>{t('Settings')}</h1>

      <label class="search">
        <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg>
        <input bind:value={query} placeholder={t('Search settings')} spellcheck="false" />
      </label>

      {#each SECTIONS as item (item.id)}
        <button
          class:active={!query && settings.section === item.id}
          onclick={() => {
            query = ''
            settings.section = item.id
          }}
        >
          <svg viewBox="0 0 16 16"><path d={ICONS[item.id]} /></svg>
          {item.label}
        </button>
      {/each}
    </nav>

    <div class="body">
      {#if query}
        <div class="pane">
          <h2>{t('Search settings')}</h2>

          {#if found.length}
            {#each found as hit (hit.pane.id + hit.field.label)}
              <div class="setting">
                <span class="name">{hit.field.label}</span>
                {@render control(hit.field)}
              </div>
              <p class="where">{hit.pane.label}</p>
            {/each}
          {:else}
            <p class="note">{t('Nothing matches.')}</p>
          {/if}
        </div>
      {:else if current}
        <div class="pane" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
          <h2>{current.label}</h2>

          {#each current.groups as group (group.title)}
            <h3>{group.title}</h3>

            {#each group.fields as field (field.label)}
              <div class="setting">
                <span class="name">{field.label}</span>
                {@render control(field)}
              </div>
            {/each}
          {/each}

          {#if settings.section === 'appearance'}
            {@render appearanceExtras()}
          {/if}
        </div>
      {:else if settings.section === 'account'}
        <div class="pane" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
          {#if account.signedIn}
            <p class="lead">{account.user?.email}</p>

            <!-- Having an account is what syncing means, so there is nothing
                 to switch: the pane only says where things stand. -->
            <p class="note">
              {t('{count} spaces sync to your account.', { count: workspace.spaces.length })}
              {#if sync.lastSyncedAt}
                {t('Last synced {time}.', {
                  time: new Date(sync.lastSyncedAt).toLocaleTimeString(),
                })}
              {/if}
            </p>

            <!-- Notes and images together, which is what the limit counts. -->
            <div class="field">
              <span class="label">{t('Storage')}</span>
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
            </div>

            <button class="quiet" onclick={() => account.signOut()}>{t('Sign out')}</button>
          {:else}
            <p class="lead">{t('Not signed in')}</p>
            <button class="primary" onclick={() => { settings.open = false; account.open = true }}>
              {t('Sign in')}
            </button>
          {/if}
        </div>
      {:else if settings.section === 'publish'}
        <div class="pane" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
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
              <label class="field">
                <span class="label">{t('What to publish')}</span>
                <select bind:value={blogNote}>
                  <option value="">{t('The whole space')}</option>
                  {#each workspace.notes as note (note.path)}
                    <option value={relativeTo(note.path)}>
                      {t('Only {name}', { name: stripped(note.name) })}
                    </option>
                  {/each}
                </select>
              </label>

              <label class="field">
                <span class="label">{t('Address')}</span>
                <div class="row">
                  <input
                    value={subdomain}
                    oninput={(event) => onSubdomain(event.currentTarget.value)}
                    placeholder="your-name"
                    spellcheck="false"
                  />
                  <span class="suffix">.nibeditor.com</span>
                </div>
                {#if settings.availability.checking}
                  <span class="hint">{t('checking…')}</span>
                {:else if settings.availability.available === true}
                  <span class="hint ok">{t('available')}</span>
                {:else if settings.availability.available === false}
                  <span class="hint bad">{t(settings.availability.reason ?? "")}</span>
                {/if}
              </label>

              <details>
                <summary>{t('Use a domain you own')}</summary>
                <div class="field" transition:slide={{ duration: 180 }}>
                  <input bind:value={domain} placeholder="notes.example.com" spellcheck="false" />
                  {#if settings.dns.length}
                    <table class="dns">
                      <thead>
                        <tr><th>{t('Type')}</th><th>{t('Name')}</th><th>{t('Value')}</th></tr>
                      </thead>
                      <tbody>
                        {#each settings.dns as record (record.name + record.type)}
                          <tr>
                            <td>{record.type}</td>
                            <td>{record.name}</td>
                            <td>{record.value}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                    <span class="hint">{t('Add this at your registrar, then reload the page.')}</span>
                  {/if}
                </div>
              </details>

              <button
                class="primary"
                disabled={settings.busy || !subdomain}
                onclick={() => settings.publish({ subdomain, domain: domain || undefined, note: blogNote || null })}
              >
                {published ? t('Update') : t('Publish')}
              </button>
            </fieldset>

            {#if published}
              <p class="note" transition:slide={{ duration: 180 }}>
                {t('Live at')}
                <a href="https://{blog?.subdomain}.nibeditor.com" target="_blank" rel="noreferrer">
                  {blog?.subdomain}.nibeditor.com
                </a>
              </p>
              <button class="quiet danger" onclick={() => settings.unpublish()}>{t('Stop publishing')}</button>
            {/if}
          {/if}
        </div>
      {:else if settings.section === 'llm'}
        <div class="pane" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
          {#if !account.signedIn}
            <p class="note">{t('Sign in first - the connector reaches the notes in your account.')}</p>
          {:else}
            <label class="switch">
              <input
                type="checkbox"
                checked={!settings.llmReadOnly}
                onchange={(event) => (settings.llmReadOnly = !event.currentTarget.checked)}
              />
              <span>{t('Let it write to my notes, not only read them')}</span>
            </label>

            {#if settings.freshToken}
              <!-- Shown once. There is no way to get it back afterwards. -->
              <div transition:slide={{ duration: 200 }}>
                <p class="note">{t("Paste this into your LLM client's MCP settings. It is shown only once.")}</p>
                <pre>{snippet}</pre>
                <button class="primary" onclick={copySnippet}>{copied ? t('Copied') : t('Copy')}</button>
              </div>
            {:else if settings.connector?.exists}
              <p class="note">
                {t('A token is active.')}
                {#if settings.connector.lastUsedAt}
                  {t('Last used {time}.', {
                    time: new Date(settings.connector.lastUsedAt).toLocaleString(),
                  })}
                {:else}
                  {t('It has not been used yet.')}
                {/if}
              </p>

              <div class="row">
                <button
                  class="primary"
                  disabled={settings.busy}
                  onclick={() => settings.createConnector(settings.llmReadOnly)}
                >
                  {t('Replace it')}
                </button>
                <button class="quiet danger" onclick={() => settings.revokeConnector()}>
                  {t('Revoke')}
                </button>
              </div>
            {:else}
              <p class="note">{t('A token lets one LLM client reach every note in your account.')}</p>
              <button
                class="primary"
                disabled={settings.busy}
                onclick={() => settings.createConnector(settings.llmReadOnly)}
              >
                {t('Create a token')}
              </button>
            {/if}
          {/if}
        </div>
      {:else if settings.section === 'export'}
        <div class="pane" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
          <div class="row">
            <label class="field">
              <span class="label">{t('Paper')}</span>
              <select
                value={settings.page.paper}
                onchange={(event) => settings.setPage({ paper: event.currentTarget.value as never })}
              >
                {#each PAPER_SIZES as size (size)}
                  <option value={size}>{size}</option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span class="label">{t('Orientation')}</span>
              <select
                value={settings.page.orientation}
                onchange={(event) =>
                  settings.setPage({ orientation: event.currentTarget.value as never })}
              >
                {#each ORIENTATIONS as option (option)}
                  <option value={option}>{t(option)}</option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span class="label">{t('Margin')}</span>
              <input
                value={settings.page.margin}
                oninput={(event) => settings.setPage({ margin: event.currentTarget.value })}
                spellcheck="false"
              />
            </label>
          </div>

          <!-- The settings above only matter once something is exported, so
               the ways of doing it belong here rather than in the palette. -->
          <div class="exports">
            {#each exportActions() as action (action.id)}
              <button class="quiet" disabled={action.disabled} onclick={action.run}>
                {action.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if settings.error}
        <p class="hint bad" transition:slide={{ duration: 160 }}>{t(settings.error)}</p>
      {/if}
    </div>
  </div>
{/if}

{#snippet control(field: Field)}
  {#if field.kind === 'switch'}
    <button
      class="toggle"
      class:on={field.get()}
      role="switch"
      aria-checked={field.get()}
      aria-label={field.label}
      onclick={() => field.set(!field.get())}
    ></button>
  {:else if field.kind === 'slider'}
    <span class="value">{field.get()}{field.unit ?? ''}</span>
    <input
      class="slider"
      type="range"
      min={field.min}
      max={field.max}
      step={field.step}
      value={field.get()}
      aria-label={field.label}
      oninput={(event) => field.set(Number(event.currentTarget.value))}
    />
  {:else}
    <select
      value={field.get()}
      aria-label={field.label}
      onchange={(event) => field.set(event.currentTarget.value)}
    >
      {#each field.options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  {/if}
{/snippet}

{#snippet appearanceExtras()}
  <h3>{t('Accent')}</h3>

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

  <h3>{t('Custom')}</h3>

  <button class="quiet" onclick={() => theme.reload()}>{t('Reload themes and custom CSS')}</button>

  {#if isWindows}
    <div class="setting">
      <span class="name">{t('Show in Explorer’s New menu')}</span>
      <button
        class="toggle"
        class:on={settings.newMenu}
        role="switch"
        aria-checked={settings.newMenu}
        aria-label={t('Show in Explorer’s New menu')}
        onclick={() => settings.setNewMenu(!settings.newMenu)}
      ></button>
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

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-4) var(--space-3);
    border-right: 1px solid var(--line);
    background: var(--bg);
    overflow-y: auto;
  }

  nav button {
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

  nav button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  nav button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .body {
    padding: var(--space-5) var(--space-6);
    overflow-y: auto;
  }

  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
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

  .hint {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .hint.ok {
    color: var(--success);
  }

  .hint.bad {
    color: var(--danger);
  }

  button.primary,
  button.quiet {
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

  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  button.quiet {
    background: none;
    color: var(--muted);
    padding-left: 0;
  }

  button.quiet:hover {
    color: var(--text);
  }

  button.quiet.danger:hover {
    color: var(--danger);
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

  .danger-check input,
  .switch input {
    flex: none;
    margin-top: 3px;
    accent-color: var(--accent);
  }

  .switch {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    font-size: var(--text-sm);
    color: var(--text);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  fieldset:disabled {
    opacity: 0.4;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
  }

  .label {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .exports {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .exports button {
    flex: none;
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

  .swatch:hover {
    transform: scale(1.12);
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

  .row input,
  .field input {
    flex: 1;
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

  .field input:focus,
  .row input:focus {
    border-color: var(--accent);
  }

  .suffix {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  details summary {
    font-size: var(--text-sm);
    color: var(--muted);
    cursor: default;
  }

  details summary:hover {
    color: var(--accent);
  }

  details .field {
    margin-top: var(--space-3);
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
  }

  .dns th {
    background: var(--surface-2);
    color: var(--muted);
    font-weight: 500;
  }

  pre {
    width: 100%;
    margin: var(--space-2) 0;
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-x: auto;
    color: var(--muted-strong);
  }

  
  
  
  
  /* A phone has no room for two columns, so the list of panes becomes a strip
     across the top and the pane fills the rest. */

  /* ── Preferences ─────────────────────────────────────────────── */

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
    margin-bottom: var(--space-3);
    padding: 0 10px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
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

  nav button svg {
    width: 15px;
    height: 15px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pane h2 {
    margin: 0 0 var(--space-4);
    font-family: var(--font-ui);
    font-size: 1.15em;
    font-weight: 620;
    color: var(--text-strong);
  }

  .pane h3 {
    margin: var(--space-5) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }

  .pane h3:first-of-type {
    margin-top: 0;
  }

  /* Name on the left, control on the right, one line each. */
  .setting {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 38px;
  }

  .setting .name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .setting select {
    flex: none;
    width: 12rem;
  }

  .setting .value {
    flex: none;
    width: 4.5rem;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .where {
    margin: -2px 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .toggle {
    flex: none;
    width: 38px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 99px;
    background: var(--surface-3);
    cursor: default;
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

  .slider {
    flex: none;
    width: 11rem;
    accent-color: var(--accent);
  }

  .accents {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  @media (max-width: 720px) {
    .sheet {
      top: auto;
      bottom: 0;
      left: 0;
      translate: none;
      width: 100%;
      height: 88dvh;
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    }

    nav {
      flex-direction: row;
      flex-wrap: nowrap;
      border-right: none;
      border-bottom: 1px solid var(--line);
      overflow-x: auto;
      scrollbar-width: none;
    }

    nav h1 {
      display: none;
    }

    .search {
      order: -1;
      flex: none;
      width: 11rem;
      margin: 0;
    }

    nav button {
      flex: none;
      min-height: 44px;
    }

    .body {
      padding: var(--space-4);
    }

    .setting {
      min-height: 48px;
    }

    /* The controls themselves, not just the rows they sit in: a 16px slider
       and a 21px switch are fine for a pointer and hopeless for a thumb. */
    .search {
      height: 40px;
    }

    .toggle {
      width: 46px;
      height: 28px;
    }

    .toggle::after {
      width: 22px;
      height: 22px;
    }

    .toggle.on::after {
      transform: translateX(18px);
    }

    .slider {
      height: 28px;
      width: 9rem;
    }

    .setting select {
      min-height: 40px;
      width: 10rem;
    }

    .accents {
      gap: 10px;
    }

    .swatch {
      width: 30px;
      height: 30px;
    }
  }
</style>
