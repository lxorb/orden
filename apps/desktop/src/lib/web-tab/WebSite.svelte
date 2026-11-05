<script lang="ts">
  /** What this site is: the popover behind the mark at the left of the address field.
   *
   *  Chrome's site information bubble, kept to what Orden can honestly say: whether the
   *  connection is the secure kind, the certificates it was made with - pressing that
   *  line shows the chain, the site's own up to the root, as a browser's viewer does
   *  (#776) - what the site has been allowed or refused, and one row that forgets
   *  all of it. A site that has never asked for anything shows the first
   *  line and nothing else, which is the common case and reads as "there is nothing to
   *  know here".
   *
   *  Turning something off here does not reach into the page. A site that already has the
   *  camera keeps it until it asks again, which is what happens in a browser too: the
   *  answer is about the next time. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import { i18n, t } from '../i18n.svelte'
  import { shownSite } from './idn'
  import { invoke } from '../tauri'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import type { Ask } from './permissions.svelte'
  import { ASKS, grants } from './permissions.svelte'

  const {
    url,
    site,
    tab,
    onclose,
    privately = false,
  }: {
    url: string | null
    site: string
    tab: string
    onclose: () => void
    /** A private tab's site, whose answers are the private session's; see permissions.svelte.ts. */
    privately?: boolean
  } = $props()

  /** Whom a certificate names; see web_certificate.rs. */
  interface Party {
    name: string
    organization: string[]
  }

  /** One certificate of the chain; see web_certificate.rs. */
  interface Link {
    to: Party
    by: Party
    from: number
    until: number
    serial: string
    sha256: string
    root: boolean
  }

  /** The certificates the page came with, the site's first, as web_certificate.rs
   *  reads them. `separately` where the engine said nothing of the page's and the
   *  chain was read from the site over a connection of the app's own. */
  interface Certificate {
    secure: boolean
    separately: boolean
    chain: Link[]
  }

  /** What each certificate of a chain is, by where it stands in it. */
  type Role = 'site' | 'intermediate' | 'root'
  const ROLES: Record<Role, () => string> = {
    site: () => t('Site'),
    intermediate: () => t('Intermediate'),
    root: () => t('Root'),
  }
  const role = (link: Link, index: number): Role =>
    index === 0 ? 'site' : link.root ? 'root' : 'intermediate'

  /** What each one is called on a row that says what a site may do. Chrome's words, so
   *  a reader who has turned one of these off in Chrome finds the same name here. */
  const NAMES: Record<Ask, () => string> = {
    camera: () => t('Camera'),
    microphone: () => t('Microphone'),
    location: () => t('Location'),
    notifications: () => t('Notifications'),
    clipboard: () => t('Clipboard'),
    sensors: () => t('Motion sensors'),
    downloads: () => t('Automatic downloads'),
    fonts: () => t('Fonts'),
    midi: () => t('MIDI devices'),
    windows: () => t('Window management'),
  }

  const https = $derived(url?.startsWith('https:') === true)

  /** Asked for as the popover opens, about the page as it is then. Null where nothing
   *  could be read, and then the address is all there is to go on. */
  let certificate = $state<Certificate | null>(null)
  let asked = $state(false)
  $effect(() => {
    if (!https || !url) {
      // The page has gone from https to http: what the last one said is not about this one.
      certificate = null
      return
    }
    let gone = false
    void invoke<Certificate | null>('web_certificate', { tab, address: url })
      .then((said) => {
        if (!gone) certificate = said
      })
      .catch(() => undefined)
      .finally(() => {
        if (!gone) asked = true
      })
    return () => (gone = true)
  })
  /** Whether the line about the connection has been pressed open, and which
   *  certificate of the chain is shown: the site's until another is chosen. */
  let showingCertificate = $state(false)
  let chosen = $state(0)
  const at = $derived(certificate && chosen < certificate.chain.length ? chosen : 0)
  const shown = $derived(certificate?.chain[at])

  const secure = $derived(certificate ? certificate.secure : https)

  /** A party as a browser names it: the name, then its organisation where it has one. */
  const named = (party: Party) =>
    [party.name, ...party.organization].filter((one) => one !== '').join(' · ')
  const day = (when: number) => i18n.when(when, { dateStyle: 'long' })
  const said = $derived(grants.of(site, privately))
  const decided = $derived(ASKS.filter((ask) => said[ask] !== undefined))

  // Closed by Escape, a press past it and the window losing the focus - which is also
  // how a press into the page under it is heard; see overlays.ts. A press on the button
  // that opened it is that button's own to answer.
  let bubble = $state<HTMLElement>()
  $effect(() =>
    overlays.show(onclose, () => [bubble, ...document.querySelectorAll('[data-opens="site"]')]),
  )
</script>

<div
  bind:this={bubble}
  class="site nib-bubble is-pressable"
  role="dialog"
  aria-label={shownSite(site)}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  {#snippet how()}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each secure ? Lock : TriangleAlert as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    <span class="said">{secure ? t('Connection is secure') : t('Connection is not secure')}</span>
  {/snippet}

  <!-- Over https the line is the way in to the certificate, as a browser's is: pressed,
       it shows the chain the page came with. A plain http page has none to show. -->
  {#if https}
    <button
      class="nib-button is-quiet how"
      class:risky={!secure}
      aria-expanded={showingCertificate}
      onclick={() => (showingCertificate = !showingCertificate)}
    >
      {@render how()}
      <svg class="chevron" class:open={showingCertificate} viewBox="0 0 24 24" aria-hidden="true">
        {#each ChevronRight as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    </button>
  {:else}
    <p class="how" class:risky={!secure}>{@render how()}</p>
  {/if}

  {#if showingCertificate}
    <section class="certificate" aria-label={t('Certificate')}>
      {#if certificate && shown}
        <ol class="chain" aria-label={t('Certificate chain')}>
          {#each certificate.chain as link, index (index)}
            <li style:--depth={index}>
              <button
                class="nib-button is-quiet"
                class:chosen={index === at}
                aria-pressed={index === at}
                data-role={role(link, index)}
                onclick={() => (chosen = index)}
              >
                <span class="role">{ROLES[role(link, index)]()}</span>
                <span class="name">{named(link.to)}</span>
              </button>
            </li>
          {/each}
        </ol>
        {#if certificate.separately}
          <p class="note">
            {t(
              'Read from the site separately: the browser engine does not say which certificate this page came with.',
            )}
          </p>
        {/if}
        <dl class="details">
          <dt>{t('Issued to')}</dt>
          <dd>{named(shown.to)}</dd>
          <dt>{t('Issued by')}</dt>
          <dd>{named(shown.by)}</dd>
          <dt>{t('Valid from')}</dt>
          <dd>{day(shown.from)}</dd>
          <dt>{t('Valid until')}</dt>
          <dd>{day(shown.until)}</dd>
          <dt>{t('Serial number')}</dt>
          <dd class="hex">{shown.serial}</dd>
          <dt>{t('SHA-256 fingerprint')}</dt>
          <dd class="hex">{shown.sha256}</dd>
        </dl>
      {:else if asked}
        <p class="note">{t('The certificate could not be read.')}</p>
      {/if}
    </section>
  {/if}

  {#if decided.length}
    <ul class="grants">
      {#each decided as ask (ask)}
        <li>
          <span>{NAMES[ask]()}</span>
          <!-- The answer, as the thing it is: a site is allowed or it is blocked, and
               pressing the word is the other answer. -->
          <button
            class="nib-button is-quiet"
            onclick={() =>
              grants.remember(site, ask, said[ask] === 'allow' ? 'block' : 'allow', privately)}
          >
            {said[ask] === 'allow' ? t('Allowed') : t('Blocked')}
          </button>
        </li>
      {/each}
    </ul>

    <button
      class="nib-button is-quiet reset"
      onclick={() => {
        grants.forget(site, privately)
        onclose()
      }}
    >
      {t('Reset permissions')}
    </button>
  {/if}
</div>

<style>
  /* Under the mark it belongs to, at the left of the bar, which is where a browser
     draws it. */
  .site {
    position: absolute;
    top: 100%;
    left: var(--space-2);
    z-index: var(--z-float);
    width: min(20rem, calc(100% - var(--space-4)));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .how {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .how > svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The line as a row to press: the width of the bubble, its words at the start and
     the chevron at the end, turned down while the certificate is open under it. */
  button.how {
    min-height: 0;
    margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-2));
    padding: var(--space-1) var(--space-2);
    justify-content: flex-start;
    color: var(--text-strong);
    font-size: var(--text-row);
    text-align: start;
  }

  .how > .said {
    flex: 1;
  }

  .how > .chevron {
    width: var(--icon-sm);
    height: var(--icon-sm);
    color: var(--text-muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .how > .chevron.open {
    transform: rotate(90deg);
  }

  /* An `http:` page is the one thing about an address worth warning somebody about, so
     the line says so in the colour a callout warns in. */
  .risky,
  button.how.risky {
    color: var(--callout-warning);
  }

  .certificate {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The chain as a browser's viewer draws it: each certificate a step in from the one
     it issued, the site's at the top. */
  .chain {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .chain > li {
    padding-inline-start: calc(var(--depth) * var(--space-2));
  }

  .chain button {
    width: 100%;
    min-height: 0;
    padding: var(--space-1) var(--space-2);
    justify-content: flex-start;
    gap: var(--space-2);
    font-size: var(--text-sm);
    text-align: start;
  }

  .chain button.chosen {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .chain .role {
    flex: none;
    color: var(--text-muted);
  }

  .chain .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .note {
    margin: 0;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  /* What a browser's certificate viewer leads with, a label over each answer. */
  .details {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .details > dt {
    color: var(--text-muted);
  }

  .details > dd {
    margin: 0 0 var(--space-1);
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .details > .hex {
    font-family: var(--font-mono);
  }

  .grants {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .grants > li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .reset {
    align-self: flex-start;
  }
</style>
