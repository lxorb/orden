<script lang="ts">
  /** Putting a space on the web: what of it is published, the address it answers
   *  at, and the records a domain of one's own needs. One sheet, because they are
   *  one question, and the same sheet sharing is drawn in: both are opened from
   *  the space's own menu and both are about who else may read it.
   *
   *  What it asks of the server is publishing.svelte.ts; the box it is drawn in
   *  is Sheet.svelte. */
  import { slide } from 'svelte/transition'
  import { domainNotice } from './domain-status'
  import { t } from './i18n.svelte'
  import { publish } from './publishing.svelte'
  import { segmented } from './slide'
  import { shownName } from './note-name'
  import Select from './Select.svelte'
  import Sheet from './Sheet.svelte'
  import { siteIcon } from './site-icon'
  import SpaceMark from './SpaceMark.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'
  import { dur } from './motion'

  const blog = $derived(publish.blog)
  const published = $derived(publish.published)
  /** A domain of one's own needs Cloudflare for SaaS on the shared zone, which
   *  is not enabled; a domain entered today would wait forever. So the choice
   *  is only shown where a space already has a domain (set by hand, served by
   *  a route of its own), and everyone else sees the shared name alone. */
  const offerDomain = $derived(!!blog?.domain)
  /** Wherever the blog answers, for the link under the button. */
  const liveAt = $derived(
    blog?.domain ?? (blog?.subdomain ? `${blog.subdomain}.nibeditor.com` : ''),
  )
  /** The records for a domain: fresh from publishing, or as the listing
   *  remembers them. */
  const records = $derived(publish.dns.length ? publish.dns : (blog?.dns ?? []))
  /** What is happening with the domain, once the server has been asked. */
  const notice = $derived(publish.status ? domainNotice(publish.status) : null)

  /** What may be published: the whole space, or one note in it.
   *
   *  The notes offered are the ones the app is holding, which are the notes of
   *  the space it is showing. A sheet opened on another space offers the whole
   *  space and whatever note it is published as already, so a choice made from
   *  inside that space is not quietly lost: picking one note out of a space is
   *  done in the space, which is where its notes are.  */
  const showing = $derived(publish.space?.id === workspace.activeSpaceId)

  const noteChoices = $derived([
    { value: '', label: t('The whole space') },
    ...(showing
      ? workspace.notes.map((note) => ({
          value: publish.relativeTo(note.path),
          label: t('Only {name}', { name: shownName(note.name) }),
        }))
      : publish.note
        ? [
            {
              value: publish.note,
              label: t('Only {name}', {
                name: shownName(publish.note.split('/').pop() ?? publish.note),
              }),
            },
          ]
        : []),
  ])

  /** How many names the changed list shows of each kind. Enough to recognise
   *  what is about to happen, few enough to read at a glance. */
  const SHOWN = 6

  /** The folders a rule can be about: the top of the tree, where somebody thinks
   *  in folders, plus any deeper one that already carries a rule - set here on
   *  another day, or on another machine. Nothing is hidden, and a vault of four
   *  hundred folders does not become four hundred rows. */
  const ruled = $derived.by(() => {
    const tops = new Set<string>()

    if (showing) {
      for (const note of workspace.notes) {
        const folder = publish.relativeTo(note.path).split('/')[0]
        if (folder && folder !== publish.relativeTo(note.path)) tops.add(folder)
      }
    }

    for (const folder of [...publish.rules.include, ...publish.rules.exclude]) tops.add(folder)

    return [...tops].sort((one, other) => one.localeCompare(other))
  })

  function ruleFor(folder: string): string {
    if (publish.rules.include.includes(folder)) return 'in'
    if (publish.rules.exclude.includes(folder)) return 'out'
    return ''
  }

  function setRule(folder: string, value: string) {
    publish.rule('include', folder, value === 'in')
    publish.rule('exclude', folder, value === 'out')
  }

  const changes = $derived(publish.changes)

  /** The badge the icon is drawn in, so that what the site wears is the mark the
   *  app has already drawn; see site-icon.ts. */
  let markBox = $state<HTMLElement | null>(null)

  // Filled from what the account holds, and again whenever it answers with
  // something new: publishing changes the blog under the form.
  $effect(() => {
    if (!publish.open) return
    publish.fill(blog)
    publish.confirmed = published
  })

  // And asked what those rules would put on the site, once, when the sheet opens
  // on a space that is already published: the answer is what the reader is about
  // to change, and it should be on screen before they change anything.
  $effect(() => {
    if (!publish.open || !publish.spaceId) return
    publish.ask()
  })

  // Asked after while the sheet shows a domain, and left alone as soon as it
  // does not: the timer would otherwise keep going behind a closed sheet.
  $effect(() => {
    if (!publish.open || !blog?.domain) return
    void publish.watchDomain()
    return () => publish.stopWatchingDomain()
  })
</script>

<Sheet
  open={publish.open}
  title={t('Publish {name}', { name: publish.space?.name ?? '' })}
  onclose={() => publish.close()}
>
  {#snippet mark()}
    <SpaceMark id={publish.space?.id ?? null} name={publish.space?.name ?? ''} />
  {/snippet}

  {#if publish.error}
    <p class="wrong">{t(publish.error)}</p>
  {/if}

  <!-- The consequence comes before the switch, not after it. What that
       consequence is depends on the rules below, so it is said in the words the
       rules make true rather than in one fixed sentence. -->
  <label class="danger-check">
    <input data-lands type="checkbox" bind:checked={publish.confirmed} disabled={published} />
    <span>
      <strong>
        {publish.rules.otherwise === 'all'
          ? t('Everything in this space becomes public.')
          : t('The folders you choose become public.')}
      </strong>
      {t('Anyone with the address can read what is published, drafts included.')}
    </span>
  </label>

  <fieldset disabled={!publish.confirmed}>
    <div class="card">
      <div class="row">
        <span class="name">{t('What to publish')}</span>
        <div class="pick">
          <Select
            value={publish.note}
            options={noteChoices}
            onchange={(value: string) => {
              publish.note = value
            }}
            label={t('What to publish')}
            plain={viewport.touch}
          />
        </div>
      </div>
    </div>

    <!-- Which notes, which is the question a space somebody already writes in
         has to be able to answer. A note that says `publish:` for itself is not
         listed here: what the author wrote in the file wins, and a row that
         could not change it would be a row that lies. -->
    {#if !publish.note}
      <h3>{t('Which notes')}</h3>

      <div class="card">
        <div class="row">
          <span class="name">{t('Notes outside a rule')}</span>
          <div class="pick">
            <Select
              value={publish.rules.otherwise}
              options={[
                { value: 'all', label: t('Are published') },
                { value: 'none', label: t('Stay private') },
              ]}
              onchange={(value: string) => publish.otherwise(value === 'none' ? 'none' : 'all')}
              label={t('Notes outside a rule')}
              plain={viewport.touch}
            />
          </div>
        </div>
      </div>

      {#if ruled.length}
        <div class="card">
          {#each ruled as folder (folder)}
            <div class="row">
              <span class="name">{folder}</span>
              <div class="pick">
                <Select
                  value={ruleFor(folder)}
                  options={[
                    { value: '', label: t('Follows the rule') },
                    { value: 'in', label: t('Published') },
                    { value: 'out', label: t('Private') },
                  ]}
                  onchange={(value: string) => setRule(folder, value)}
                  label={folder}
                  plain={viewport.touch}
                />
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- What this will do, before it is done. A nib site is live - the page is
           the note - so the only thing a publish changes is which pages exist,
           and that is what this says. -->
      {#if changes}
        <p class="note" transition:slide={{ duration: dur(160) }}>
          {t('{count} pages', { count: changes.pages })}
          {#if changes.adds.length}· {t('{count} new', { count: changes.adds.length })}{/if}
          {#if changes.removes.length}· {t('{count} gone', { count: changes.removes.length })}{/if}
        </p>
        {#if changes.adds.length || changes.removes.length}
          <ul class="changed">
            {#each changes.adds.slice(0, SHOWN) as path (path)}
              <li class="added">{shownName(path)}</li>
            {/each}
            {#each changes.removes.slice(0, SHOWN) as path (path)}
              <li class="gone">{shownName(path)}</li>
            {/each}
            {#if changes.more || changes.adds.length + changes.removes.length > SHOWN * 2}
              <li class="rest">{t('and more')}</li>
            {/if}
          </ul>
        {/if}
      {/if}
    {/if}

    <!-- One address or the other. The choice is the control, so there is no way
         to end up asking for both. -->
    <h3>{t('Address')}</h3>
    {#if offerDomain}
      <div class="nib-segmented" role="radiogroup" aria-label={t('Address')} use:segmented>
        <button
          type="button"
          role="radio"
          aria-checked={publish.address === 'subdomain'}
          class:on={publish.address === 'subdomain'}
          onclick={() => (publish.address = 'subdomain')}
        >
          {t('On nibeditor.com')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={publish.address === 'domain'}
          class:on={publish.address === 'domain'}
          onclick={() => (publish.address = 'domain')}
        >
          {t('Your own domain')}
        </button>
      </div>
    {/if}

    {#if !offerDomain || publish.address === 'subdomain'}
      <div class="stack">
        <div class="row">
          <input
            class="field"
            value={publish.subdomain}
            oninput={(event) => publish.typeSubdomain(event.currentTarget.value)}
            placeholder="your-name"
            spellcheck="false"
            autocapitalize="off"
          />
          <span class="suffix">.nibeditor.com</span>
        </div>
        {#if publish.availability.checking}
          <span class="hint">{t('checking…')}</span>
        {:else if publish.availability.available === true}
          <span class="hint ok">{t('available')}</span>
        {:else if publish.availability.available === false}
          <span class="hint bad">{t(publish.availability.reason ?? '')}</span>
        {/if}
        {#if published && blog?.domain}
          <span class="hint">{t('Switching gives up {name}.', { name: blog.domain })}</span>
        {/if}
      </div>
    {:else}
      <div class="stack">
        <input
          class="field"
          bind:value={publish.domain}
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
          <span class="hint">{t('Add these at your registrar, then verify.')}</span>
          <button
            class="action"
            disabled={publish.busy || !blog?.domain}
            onclick={() => void publish.verifyDomain()}
          >
            {t('Verify')}
          </button>
        {/if}
        {#if notice}
          <span class="hint" class:ok={notice.tone === 'ok'} class:bad={notice.tone === 'bad'}>
            {t(notice.text)}
            {#if notice.detail}{t(notice.detail)}{/if}
          </span>
        {/if}
      </div>
    {/if}

    <!-- How a page of it looks to something that is not a person: a search
         result, a link pasted into a chat, a browser tab. Each page says this for
         itself in its own front matter; what is here is what the ones that say
         nothing fall back on. -->
    <h3>{t('How it appears')}</h3>

    <div class="card">
      <label class="row">
        <span class="name">{t('Description')}</span>
        <input
          class="field wide"
          bind:value={publish.description}
          placeholder={t('What this site is')}
          spellcheck="false"
        />
      </label>
      <div class="row">
        <span class="name">{t('Tab icon')}</span>
        <!-- The space's own mark, which is what the site wears: one space, one
             icon, changed where a space's icon is changed. -->
        <span class="mark nib-badge" bind:this={markBox}>
          <SpaceMark id={publish.space?.id ?? null} name={publish.space?.name ?? ''} />
        </span>
      </div>
    </div>

    <!-- A word said out loud to a room, which is what this is for; see
         services/sync/src/blog/gate.ts. -->
    <h3>{t('Password')}</h3>

    <div class="card">
      <label class="row">
        <span class="name">
          {publish.hasPassword ? t('Set a new one') : t('Ask for a password')}
        </span>
        <input
          class="field"
          type="password"
          bind:value={publish.password}
          placeholder={publish.hasPassword ? '••••••' : t('No password')}
          autocomplete="new-password"
        />
      </label>
      {#if publish.hasPassword}
        <button
          class="action danger"
          disabled={publish.busy}
          onclick={() => void publish.removePassword()}
        >
          {t('Remove the password')}
        </button>
      {/if}
    </div>

    <button
      class="primary go"
      disabled={!publish.ready}
      onclick={() => void publish.publish(siteIcon(markBox))}
    >
      {published ? t('Update') : t('Publish')}
    </button>
  </fieldset>

  {#if published && liveAt}
    <p class="note" transition:slide={{ duration: dur(180) }}>
      {t('Live at')}
      <a href="https://{liveAt}" target="_blank" rel="noreferrer">{liveAt}</a>
    </p>
    <div class="card">
      <button class="action danger" onclick={() => void publish.unpublish()}>
        {t('Stop publishing')}
      </button>
    </div>
  {/if}
</Sheet>

<style>
  /* Everything the form offers goes quiet together until the warning above it
     has been read and ticked. */
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

  /* Wide enough for the longest note name a space is likely to hold. */
  /* What a publish would change: a short list of names, the new ones and the
     ones going away told apart by the mark in front of them rather than by
     colour alone. */
  .changed {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    margin: calc(-1 * var(--space-2)) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }

  .changed li::before {
    display: inline-block;
    width: 1.1em;
    color: var(--muted);
    font-family: var(--font-mono);
  }

  .changed .added::before {
    content: '+';
    color: var(--success);
  }

  .changed .gone::before {
    content: '−';
    color: var(--danger);
  }

  .changed .rest {
    color: var(--muted);
  }

  .changed .rest::before {
    content: '';
  }

  /* The space's own mark, at the size a row's control would be: it is what the
     site wears in a browser tab. */
  .mark {
    flex: none;
  }

  /* A description is a sentence rather than a word, so its field takes the rest
     of the row. */
  .field.wide {
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .pick {
    flex: none;
    width: 13rem;
  }

  /* What the typed name is followed by, which is not typed. */
  .suffix {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  /* The segmented control is one shape for the whole app; see .nib-segmented in
     the themes package. Here it only has to take the width it is given. */
  .nib-segmented {
    width: 100%;
  }

  /* The records are as wide as a registrar writes them, and the sheet is not:
     the table scrolls rather than the sheet. */
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
    font-weight: var(--weight-strong);
  }

  /* The one thing the sheet is for sits under the form rather than beside it. */
  .go {
    align-self: flex-start;
  }

  :global([data-touch]) .danger-check {
    padding: var(--touch-pad);
    border-radius: var(--radius-lg);
    font-size: var(--text-base);
  }

  :global([data-touch]) .danger-check input {
    width: 20px;
    height: 20px;
    margin-top: 1px;
  }

  :global([data-touch]) .pick {
    width: auto;
    max-width: 60%;
  }

  :global([data-touch]) .suffix {
    font-size: var(--text-base);
  }

  :global([data-touch]) .go {
    align-self: stretch;
    justify-content: center;
  }
</style>
