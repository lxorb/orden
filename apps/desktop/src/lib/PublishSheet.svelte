<script lang="ts">
  import { domainNotice } from './domain-status'
  import { localDate } from './region'
  import { publish } from './publishing.svelte'
  import { segmented } from './slide'
  import { shownName } from './note-name'
  import { nameOf } from './space-paths'
  import Facts from './Facts.svelte'
  import Select from './Select.svelte'
  import Sheet from './Sheet.svelte'
  import { chooseTarget, download, writeFile } from './export/save'
  import { siteIcon } from './site-icon'
  import { isDesktop, openExternal } from './tauri'
  import SpaceMark from './SpaceMark.svelte'
  import { readableSize } from './usage.svelte'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'
  import { dur, slide } from './motion'

  const blog = $derived(publish.blog)
  const published = $derived(publish.published)
  const offerDomain = $derived(!!blog?.domain)
  const liveAt = $derived(blog?.domain ?? (blog?.subdomain ? `${blog.subdomain}.orden.so` : ''))
  const records = $derived(publish.dns.length ? publish.dns : (blog?.dns ?? []))
  const notice = $derived(publish.status ? domainNotice(publish.status) : null)

  const showing = $derived(publish.space?.id === workspace.activeSpaceId)

  const noteChoices = $derived([
    { value: '', label: 'The whole space' },
    ...(showing
      ? workspace.notes.map((note) => ({
          value: publish.relativeTo(note.path),
          label: `Only ${shownName(note.name)}`,
        }))
      : publish.note
        ? [
            {
              value: publish.note,
              label: `Only ${shownName(nameOf(publish.note))}`,
            },
          ]
        : []),
  ])

  const SHOWN = 6

  const SHOWN_ANSWERS = 20

  const when = (stamp: number) => localDate(stamp, { dateStyle: 'short', timeStyle: 'short' })

  async function saveAnswers() {
    const csv = await publish.answersCsv()
    if (!csv) return

    const name = `${publish.space?.name ?? 'answers'} answers`
    if (isDesktop) {
      const target = await chooseTarget(name, 'csv', 'Spreadsheet')
      if (target) await writeFile(target, csv)
      return
    }

    download(`${name}.csv`, { text: csv, mime: 'text/csv' })
  }

  const ruled = $derived.by(() => {
    const tops: string[] = []
    const seen = (folder: string) => {
      if (folder && !tops.includes(folder)) tops.push(folder)
    }

    if (showing) {
      for (const note of workspace.notes) {
        const relative = publish.relativeTo(note.path)
        const folder = relative.split('/')[0] ?? ''
        if (folder !== relative) seen(folder)
      }
    }

    for (const folder of [...publish.rules.include, ...publish.rules.exclude]) seen(folder)

    return tops.sort((one, other) => one.localeCompare(other))
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

  const everything = $derived(
    publish.rules.otherwise === 'all' &&
      !publish.rules.exclude.length &&
      !publish.rules.include.length,
  )

  let markBox = $state<HTMLElement | null>(null)

  $effect(() => {
    if (!publish.open) return
    publish.refill()
  })

  $effect(() => {
    if (!publish.open || !publish.spaceId) return
    publish.ask()
    void publish.readAnswers()
  })

  $effect(() => {
    if (!publish.open || !blog?.domain) return
    void publish.watchDomain()
    return () => publish.stopWatchingDomain()
  })
</script>

<Sheet
  open={publish.open}
  title="Publish {publish.space?.name ?? ''}"
  onclose={() => publish.close()}
>
  {#snippet mark()}
    <SpaceMark id={publish.space?.id ?? null} name={publish.space?.name ?? ''} />
  {/snippet}

  {#snippet foot()}
    <button
      class="orden-button go"
      disabled={!publish.confirmed || !publish.ready}
      onclick={() => void publish.publish(siteIcon(markBox))}
    >
      {published ? 'Update' : 'Publish'}
    </button>
  {/snippet}

  {#if publish.error}
    <p class="wrong">{publish.error}</p>
  {/if}

  <label class="danger-check">
    <input data-lands type="checkbox" bind:checked={publish.confirmed} disabled={published} />
    <span>
      <strong>
        {everything
          ? 'Everything in this space becomes public.'
          : 'The folders you choose become public.'}
      </strong>
      Anyone with the address can read what is published, drafts included.
    </span>
  </label>

  <fieldset disabled={!publish.confirmed}>
    <div class="card">
      <div class="row">
        <span class="name">What to publish</span>
        <div class="pick">
          <Select
            value={publish.note}
            options={noteChoices}
            onchange={(value: string) => {
              publish.note = value
            }}
            label="What to publish"
            plain={viewport.touch}
          />
        </div>
      </div>
    </div>

    {#if !publish.note}
      <h3>Which notes</h3>

      <div class="card">
        <div class="row">
          <span class="name">Notes outside a rule</span>
          <div class="pick">
            <Select
              value={publish.rules.otherwise}
              options={[
                { value: 'all', label: 'Are published' },
                { value: 'none', label: 'Stay private' },
              ]}
              onchange={(value: string) => publish.otherwise(value === 'none' ? 'none' : 'all')}
              label="Notes outside a rule"
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
                    { value: '', label: 'Follows the rule' },
                    { value: 'in', label: 'Published' },
                    { value: 'out', label: 'Private' },
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

      {#if changes}
        <p class="note" transition:slide={{ duration: dur(160) }}>
          <Facts
            parts={[
              `${changes.pages} pages`,
              changes.adds.length ? `${changes.adds.length} new` : '',
              changes.removes.length ? `${changes.removes.length} gone` : '',
              changes.bytes ? readableSize(changes.bytes) : '',
            ]}
          />
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
              <li class="rest">and more</li>
            {/if}
          </ul>
        {/if}
      {/if}
    {/if}

    <h3>Address</h3>
    {#if offerDomain}
      <div class="orden-segmented" role="radiogroup" aria-label="Address" use:segmented>
        <button
          type="button"
          role="radio"
          aria-checked={publish.address === 'subdomain'}
          class:on={publish.address === 'subdomain'}
          onclick={() => (publish.address = 'subdomain')}
        >
          On orden.so
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={publish.address === 'domain'}
          class:on={publish.address === 'domain'}
          onclick={() => (publish.address = 'domain')}
        >
          Your own domain
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
          <span class="suffix">.orden.so</span>
        </div>
        {#if publish.availability.checking}
          <span class="hint">checking…</span>
        {:else if publish.availability.available === true}
          <span class="hint ok">available</span>
        {:else if publish.availability.available === false}
          <span class="hint bad">{publish.availability.reason ?? ''}</span>
        {/if}
        {#if published && blog?.domain}
          <span class="hint">Switching gives up {blog.domain}.</span>
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
            Switching gives up {blog.subdomain}.orden.so.
          </span>
        {/if}
        {#if records.length}
          <div class="scrolls">
            <table class="dns">
              <thead>
                <tr><th>Type</th><th>Name</th><th>Value</th></tr>
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
              <span class="hint">{record.note}</span>
            {/if}
          {/each}
          <span class="hint">Add these at your registrar, then verify.</span>
          <button
            class="orden-action"
            disabled={publish.busy || !blog?.domain}
            onclick={() => void publish.verifyDomain()}
          >
            Verify
          </button>
        {/if}
        {#if notice}
          <span class="hint" class:ok={notice.tone === 'ok'} class:bad={notice.tone === 'bad'}>
            {notice.text}
            {#if notice.detail}{notice.detail}{/if}
          </span>
        {/if}
      </div>
    {/if}

    <h3>How it appears</h3>

    <div class="card">
      <label class="row">
        <span class="name">Description</span>
        <input
          class="field wide"
          bind:value={publish.description}
          placeholder="What this site is"
          spellcheck="false"
        />
      </label>
      <div class="row">
        <span class="name">Tab icon</span>
        <span class="mark orden-badge" bind:this={markBox}>
          <SpaceMark id={publish.space?.id ?? null} name={publish.space?.name ?? ''} />
        </span>
      </div>
      <div class="row">
        <span class="name">Theme</span>
        <div class="pick">
          <Select
            value={publish.themeName}
            options={[{ value: '', label: 'The app’s own' }, ...publish.themes]}
            onchange={(value: string) => (publish.themeName = value)}
            label="Theme"
            plain={viewport.touch}
          />
        </div>
      </div>
    </div>

    {#if changes && (changes.dressing.css || changes.dressing.js)}
      <p class="hint">
        {changes.dressing.css && changes.dressing.js
          ? 'publish.css and publish.js in this space dress the site.'
          : changes.dressing.css
            ? 'publish.css in this space dresses the site.'
            : 'publish.js in this space runs on the site.'}
      </p>
    {/if}

    <h3>Visits</h3>

    <div class="card">
      <label class="row">
        <span class="name">Counter script</span>
        <input
          class="field wide"
          bind:value={publish.counter}
          placeholder="https://plausible.io/js/script.js"
          spellcheck="false"
          autocapitalize="off"
        />
      </label>
      {#if publish.counter}
        <label class="row">
          <span class="name">Site name it expects</span>
          <input
            class="field"
            bind:value={publish.counterDomain}
            placeholder={liveAt || 'example.com'}
            spellcheck="false"
            autocapitalize="off"
          />
        </label>
      {/if}
    </div>

    <p class="hint">
      The reader’s visit goes to whoever serves that script. Nothing is sent when it is empty.
    </p>

    <h3>Password</h3>

    <div class="card">
      <label class="row">
        <span class="name">
          {publish.hasPassword ? 'Set a new one' : 'Ask for a password'}
        </span>
        <input
          class="field"
          type="password"
          bind:value={publish.password}
          placeholder={publish.hasPassword ? '••••••' : 'No password'}
          autocomplete="new-password"
        />
      </label>
      {#if publish.hasPassword}
        <button
          class="orden-action is-danger"
          disabled={publish.busy}
          onclick={() => void publish.removePassword()}
        >
          Remove the password
        </button>
      {/if}
    </div>
  </fieldset>

  {#if published && liveAt}
    <p class="note" transition:slide={{ duration: dur(180) }}>
      Live at
      <a
        href="https://{liveAt}"
        onclick={(event) => {
          event.preventDefault()
          void openExternal(`https://${liveAt}`)
        }}>{liveAt}</a
      >
    </p>

    {#if publish.answers.length}
      <h3>Answers</h3>
      {#if publish.kept}
        <p class="hint" class:bad={publish.kept.full}>
          <Facts parts={[`Kept for ${publish.kept.days} days`, publish.kept.full && 'Full']} />
        </p>
      {/if}

      <div class="card">
        {#each publish.answers.slice(0, SHOWN_ANSWERS) as one (one.id)}
          <div class="answer">
            <span class="name">
              {shownName(nameOf(one.path))}
              <small>{when(one.at)}</small>
            </span>
            <span class="said">
              <Facts
                parts={Object.entries(one.answers).map(
                  ([question, said]) => `${question}: ${said}`,
                )}
              />
            </span>
            <button class="orden-chip" onclick={() => void publish.forget(one)}>Delete</button>
          </div>
        {/each}
      </div>

      <div class="card">
        <button class="orden-action" onclick={() => void saveAnswers()}> Save as CSV </button>
      </div>
    {/if}

    <div class="card">
      <button class="orden-action is-danger" onclick={() => void publish.unpublish()}>
        Stop publishing
      </button>
    </div>
  {/if}
</Sheet>

<style>
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
    align-self: start;
    margin-top: 3px;
    accent-color: var(--accent);
  }

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

  .answer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    width: 100%;
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
  }

  .answer + .answer {
    border-top: 1px solid var(--line);
  }

  .answer .name {
    flex: 1;
    min-width: 0;
    color: var(--text-strong);
  }

  .answer .name small {
    margin-inline-start: var(--space-2);
    color: var(--muted);
  }

  .answer .said {
    flex: 1 0 100%;
    color: var(--muted-strong);
  }

  .mark {
    flex: none;
  }

  .field.wide {
    flex: 1;
    min-width: 0;
    text-align: start;
  }

  .pick {
    flex: none;
    width: 13rem;
  }

  .suffix {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .orden-segmented {
    width: 100%;
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
    text-align: start;
    white-space: nowrap;
  }

  .dns th {
    background: var(--surface-2);
    color: var(--muted);
    font-weight: var(--weight-strong);
  }

  .go {
    margin-inline-start: auto;
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
    flex: 1;
    justify-content: center;
  }
</style>
