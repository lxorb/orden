<script lang="ts">
  import { flagsOf, report, type Flag } from '@orden/pass/monitor'
  import type { Item } from '@orden/pass/types'
  import { hostOf } from '@orden/pass/urls'
  import { wifiUri } from '@orden/pass/wifi'
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
  import Pin from 'lucide/dist/esm/icons/pin.mjs'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import { i18n, plural, t } from '../i18n.svelte'
  import { iconChoice } from '../icon-choice.svelte'
  import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
  import { dur, fade } from '../motion'
  import { prompt } from '../prompt.svelte'
  import { said } from '../said.svelte'
  import AliasPanel from './AliasPanel.svelte'
  import AttachmentsView from './AttachmentsView.svelte'
  import FieldRow from './FieldRow.svelte'
  import Glyph from './Glyph.svelte'
  import { groupsOf } from './item-fields'
  import ItemMark from './ItemMark.svelte'
  import { noteHtml } from './note-html'
  import PasskeysView from './PasskeysView.svelte'
  import { hidesPasswords, mayEdit } from './share-rules'
  import SshPrint from './SshPrint.svelte'
  import { pass } from './store.svelte'
  import TotpRow from './TotpRow.svelte'
  import type { PassUi } from './ui.svelte'
  import VaultMark from './VaultMark.svelte'
  import { openSite } from './websites'

  const { ui, item, stepped = false }: { ui: PassUi; item: Item; stepped?: boolean } = $props()

  const content = $derived(item.content)
  const vault = $derived(pass.vaults.find((one) => one.id === item.vault) ?? null)
  const sealed = $derived(vault !== null && hidesPasswords(vault))
  const linkable = $derived(vault !== null && mayEdit(vault))
  const trashed = $derived(item.trashed !== null)
  const groups = $derived(groupsOf(content))
  const monitored = $derived(report(pass.items, ui.compromised))
  const flags = $derived(flagsOf(item, monitored))
  const reusedWith = $derived(monitored.reused.get(item.id)?.length ?? 0)
  const note = $derived(content.note.trim() === '' ? '' : noteHtml(content.note))

  let qr = $state<string | null>(null)
  let showingQr = $state(false)

  $effect(() => {
    if (!showingQr || sealed || content.kind !== 'wifi') {
      qr = null
      return
    }
    const uri = wifiUri(content.ssid, content.password, content.security)
    let current = true
    void import('uqr')
      .then(({ renderSVG }) => {
        if (current) qr = renderSVG(uri, { border: 1, pixelSize: 6 })
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  })

  function flagWord(flag: Flag): string {
    switch (flag) {
      case 'compromised':
        return t('This password was found in a data breach')
      case 'weak':
        return t('This password is weak')
      case 'reused':
        return plural(reusedWith, {
          one: 'This password is used for {count} other login',
          other: 'This password is used for {count} other logins',
        })
      case 'inactive2fa':
        return t('This site offers two-factor authentication')
      case 'excluded':
        return t('Left out of Monitor')
    }
  }

  function linkPressed(event: MouseEvent) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) openSite(href)
  }

  const when = (stamp: number | null) =>
    stamp === null ? t('Never') : i18n.when(stamp, { dateStyle: 'medium', timeStyle: 'short' })

  async function moveToTrash() {
    await pass.trash([item.id])
    said.say(t('Moved to trash'))
  }

  async function removeForGood() {
    const sure = await prompt.confirm({
      title: t('Delete {title} for good?', { title: content.title || t('Untitled') }),
      detail: t('This cannot be undone.'),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!sure) return
    await pass.remove([item.id])
    ui.show({ item: null })
    ui.column = 'list'
  }

  async function duplicated() {
    const made = await pass.duplicate(item.id)
    await ui.openItem(made.id)
  }

  function shareEntries(): Promise<MenuEntry[]> {
    return Promise.resolve([
      {
        label: t('Create secure link'),
        run: () => (ui.sheet = { kind: 'link', item: item.id }),
      },
    ])
  }

  function shareShown(from: Element) {
    const box = from.getBoundingClientRect()
    const at = new MouseEvent('contextmenu', { clientX: box.right, clientY: box.bottom })
    void shareEntries().then((rows) => menu.show(at, rows, { title: t('Share') }))
  }

  function chooseIcon() {
    const now = item.content
    if (now.kind !== 'custom') return
    const id = item.id
    iconChoice.pass(now.mark ?? null, (mark) => {
      const latest = pass.items.find((one) => one.id === id)?.content
      if (latest?.kind !== 'custom') return
      void pass.update(id, { ...latest, mark: mark ?? undefined })
    })
  }

  function entries(from: Element): MenuEntry[] {
    if (trashed) {
      return [
        { label: t('Restore'), run: () => void pass.restore([item.id]) },
        { label: t('Delete permanently'), danger: true, run: () => void removeForGood() },
      ]
    }
    return [
      {
        label: item.pinned ? t('Unpin') : t('Pin'),
        run: () => void pass.pin(item.id, !item.pinned),
      },
      { label: t('Move to…'), run: () => (ui.sheet = { kind: 'move', ids: [item.id] }) },
      ...(sealed
        ? []
        : [
            { label: t('Duplicate'), run: () => void duplicated() },
            { label: t('History'), run: () => (ui.sheet = { kind: 'history', item: item.id }) },
          ]),
      ...(content.kind === 'custom' && linkable
        ? [{ label: t('Choose an icon'), run: () => chooseIcon() }]
        : []),
      ...(linkable ? [{ label: t('Share'), more: shareEntries, run: () => shareShown(from) }] : []),
      ...(content.kind === 'login'
        ? [
            {
              label: item.monitored ? t('Exclude from Monitor') : t('Include in Monitor'),
              run: () => void pass.monitor(item.id, !item.monitored),
            },
          ]
        : []),
      DIVIDER,
      { label: t('Move to trash'), danger: true, run: () => void moveToTrash() },
    ]
  }
</script>

<article class="item" aria-label={content.title} in:fade={{ duration: dur(120) }}>
  <header class="head">
    {#if stepped}
      <button
        class="orden-glyph"
        type="button"
        aria-label={t('Back')}
        title={t('Back')}
        onclick={() => ui.back()}
      >
        <Glyph icon={ArrowLeft} />
      </button>
    {/if}
    <ItemMark {content} big />
    <div class="named">
      <h2 class="title">
        {content.title || t('Untitled')}
        {#if item.pinned}<span class="pinned" title={t('Pinned')}><Glyph icon={Pin} /></span>{/if}
      </h2>
      {#if vault}
        <span class="vault"
          ><VaultMark color={vault.color} icon={vault.icon} mark={vault.mark} />{vault.name}</span
        >
      {/if}
    </div>
    {#if trashed}
      <button
        class="orden-button is-quiet is-soft"
        type="button"
        onclick={() => void pass.restore([item.id])}
      >
        {t('Restore')}
      </button>
    {:else}
      <button class="orden-button" type="button" onclick={() => void ui.edit(item.id)}
        >{t('Edit')}</button
      >
    {/if}
    <button
      class="orden-glyph"
      type="button"
      aria-label={t('More')}
      title={t('More')}
      onclick={(event) => menu.show(event, entries(event.currentTarget))}
    >
      <Glyph icon={Ellipsis} />
    </button>
  </header>

  <div class="body" data-scrolls>
    {#each flags.filter((one) => one !== 'excluded') as flag (flag)}
      <p class="flag" data-flag={flag}><Glyph icon={TriangleAlert} />{flagWord(flag)}</p>
    {/each}

    {#each groups as group (group.id)}
      <section class="card" aria-label={group.name || null}>
        {#if group.name}<h3 class="orden-section">{group.name}</h3>{/if}
        {#each group.fields as field (field.id)}
          {#if field.kind === 'totp' && sealed}
            <FieldRow label={field.label} value="" hidden sealed />
          {:else if field.kind === 'totp'}
            <TotpRow secret={field.value} label={field.label} />
          {:else}
            <FieldRow
              label={field.label}
              value={field.value}
              hidden={field.kind === 'hidden'}
              sealed={sealed && field.kind === 'hidden'}
              mono={field.mono ?? false}
              strength={field.strength ?? false}
              multiline={field.multiline ?? false}
            />
          {/if}
        {/each}
      </section>
    {/each}

    {#if content.kind === 'alias'}
      <AliasPanel {item} {content} />
    {/if}

    {#if content.kind === 'ssh'}
      <SshPrint {content} />
    {/if}

    {#if content.kind === 'wifi' && !sealed}
      <section class="card">
        <button class="line is-pressable" type="button" onclick={() => (showingQr = !showingQr)}>
          <span>{showingQr ? t('Hide QR code') : t('Show QR code')}</span>
        </button>
        {#if qr}
          <div class="qr" aria-label={t('QR code to join {network}', { network: content.ssid })}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- the square uqr drew from the network's own name and password -->
            {@html qr}
          </div>
        {/if}
      </section>
    {/if}

    {#if content.kind === 'login' && content.websites.length}
      <section class="card">
        <h3 class="orden-section">{t('Websites')}</h3>
        {#each content.websites as website, index (index)}
          <button
            class="line is-pressable site"
            type="button"
            onclick={() => openSite(website.url)}
          >
            <span class="address">{hostOf(website.url) ?? website.url}</span>
            <Glyph icon={ExternalLink} />
          </button>
        {/each}
      </section>
    {/if}

    {#if content.kind === 'login'}
      <PasskeysView {item} {content} />
    {/if}

    {#if note}
      <section class="card">
        <h3 class="orden-section">{t('Note')}</h3>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note rendered with every tag of its own escaped -->
        <div class="note orden-rendered" onclick={linkPressed}>{@html note}</div>
      </section>
    {/if}

    <AttachmentsView {item} />

    <dl class="times">
      <div>
        <dt>{t('Modified')}</dt>
        <dd>{when(item.modified)}</dd>
      </div>
      <div>
        <dt>{t('Created')}</dt>
        <dd>{when(item.created)}</dd>
      </div>
      {#if content.kind === 'login'}
        <div>
          <dt>{t('Last used')}</dt>
          <dd>{when(item.used)}</dd>
        </div>
      {/if}
    </dl>
  </div>
</article>

<style>
  .item {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  .named {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .pinned {
    color: var(--muted);
  }

  .vault {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    --row-height-sm: 18px;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-5);
  }

  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > .orden-section {
    margin: 0;
    padding: var(--space-3) var(--space-3) var(--space-1);
  }

  .flag {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--callout-warning) 14%, transparent);
    color: var(--text-strong);
    font-size: var(--text-sm);
  }

  .flag[data-flag='compromised'] {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }

  .flag :global(.glyph) {
    color: var(--callout-warning);
  }

  .flag[data-flag='compromised'] :global(.glyph) {
    color: var(--danger);
  }

  .line {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    text-align: start;
  }

  .line + .line {
    border-top: 1px solid var(--line);
  }

  .line.is-pressable:hover {
    background: var(--surface-hover);
  }

  .site {
    color: var(--accent);
  }

  .address {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qr {
    display: grid;
    place-items: center;
    padding: var(--space-3);
  }

  .qr :global(svg) {
    width: 180px;
    height: 180px;
    border-radius: var(--radius-md);
    background: #fff;
  }

  .note {
    padding: var(--space-1) var(--space-3) var(--space-3);
    font-size: var(--text-row);
    color: var(--text);
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }

  .note :global(:first-child) {
    margin-top: 0;
  }

  .note :global(:last-child) {
    margin-bottom: 0;
  }

  .times {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    padding: 0 var(--space-1);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .times div {
    display: flex;
    gap: var(--space-2);
  }

  .times dt {
    min-width: 6rem;
  }

  .times dd {
    margin: 0;
    color: var(--muted-strong);
  }
</style>
