<script lang="ts">
  import Facts from '../Facts.svelte'
  import { cubicOut } from 'svelte/easing'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import { i18n, t } from '../i18n.svelte'
  import { shownSite } from './idn'
  import { invoke } from '../tauri'
  import { dur, fly } from '../motion'
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
    privately?: boolean
  } = $props()

  interface Party {
    name: string
    organization: string[]
  }

  interface Link {
    to: Party
    by: Party
    from: number
    until: number
    serial: string
    sha256: string
    root: boolean
  }

  interface Certificate {
    secure: boolean
    separately: boolean
    chain: Link[]
  }

  type Role = 'site' | 'intermediate' | 'root'
  const ROLES: Record<Role, () => string> = {
    site: () => t('Site'),
    intermediate: () => t('Intermediate'),
    root: () => t('Root'),
  }
  const role = (link: Link, index: number): Role =>
    index === 0 ? 'site' : link.root ? 'root' : 'intermediate'

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

  let certificate = $state<Certificate | null>(null)
  let asked = $state(false)
  $effect(() => {
    if (!https || !url) {
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
  let showingCertificate = $state(false)
  let chosen = $state(0)
  const at = $derived(certificate && chosen < certificate.chain.length ? chosen : 0)
  const shown = $derived(certificate?.chain[at])

  const secure = $derived(certificate ? certificate.secure : https)

  const named = (party: Party) => [party.name, ...party.organization]
  const day = (when: number) => i18n.when(when, { dateStyle: 'long' })
  const said = $derived(grants.of(site, privately))
  const decided = $derived(ASKS.filter((ask) => said[ask] !== undefined))

  let bubble = $state<HTMLElement>()
  $effect(() =>
    overlays.show(onclose, () => [bubble, ...document.querySelectorAll('[data-opens="site"]')]),
  )
</script>

<div
  bind:this={bubble}
  class="site orden-bubble is-pressable"
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

  {#if https}
    <button
      class="orden-button is-quiet how"
      class:risky={!secure}
      aria-expanded={showingCertificate}
      onclick={() => (showingCertificate = !showingCertificate)}
    >
      {@render how()}
      <svg
        class="chevron orden-mirror"
        class:open={showingCertificate}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
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
                class="orden-button is-quiet"
                class:chosen={index === at}
                aria-pressed={index === at}
                data-role={role(link, index)}
                onclick={() => (chosen = index)}
              >
                <span class="role">{ROLES[role(link, index)]()}</span>
                <span class="name"><Facts parts={named(link.to)} /></span>
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
          <dd><Facts parts={named(shown.to)} /></dd>
          <dt>{t('Issued by')}</dt>
          <dd><Facts parts={named(shown.by)} /></dd>
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
          <button
            class="orden-button is-quiet"
            onclick={() =>
              grants.remember(site, ask, said[ask] === 'allow' ? 'block' : 'allow', privately)}
          >
            {said[ask] === 'allow' ? t('Allowed') : t('Blocked')}
          </button>
        </li>
      {/each}
    </ul>

    <button
      class="orden-button is-quiet reset"
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
    transform: scaleX(var(--dir)) rotate(90deg);
  }

  .risky,
  button.how.risky {
    color: var(--callout-warning);
  }

  .certificate {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

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
