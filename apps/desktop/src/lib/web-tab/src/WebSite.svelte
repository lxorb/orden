<script lang="ts">
  import Glyph from './Glyph.svelte'
  import { Facts, overlays } from '../../ui-kit/src/api'
  import { cubicOut } from 'svelte/easing'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import { localDate, invoke, dur, fly } from '../../platform/src/api'
  import { shownSite } from './idn'
  import { ASK_NAMES, ASKS, grants } from './permissions.svelte'
  import { CopyButton } from '../../ui-controls/src/api'

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
    site: () => 'Site',
    intermediate: () => 'Intermediate',
    root: () => 'Root',
  }
  const role = (link: Link, index: number): Role => (index === 0 ? 'site' : link.root ? 'root' : 'intermediate')
  const https = $derived(url?.startsWith('https:') === true)
  let certificate = $state<Certificate | null>(null)
  let asked = $state(false)
  $effect(() => {
    certificate = null
    asked = false
    if (!https || !url) return
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
  const breakable = (hex: string) => hex.replaceAll(':', ':\u200b')
  const day = (when: number) => localDate(when, { dateStyle: 'long' })
  const said = $derived(grants.of(site, privately))
  const decided = $derived(ASKS.filter((ask) => said[ask] !== undefined))
  let bubble = $state<HTMLElement>()
  $effect(() => overlays.show(onclose, () => [bubble, ...document.querySelectorAll('[data-opens="site"]')]))
</script>

<div
  bind:this={bubble}
  class="site orden-bubble is-pressable"
  class:wide={showingCertificate}
  role="dialog"
  aria-label={shownSite(site)}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  {#snippet party(one: Party)}
    <span class="lines">
      <span>{one.name}</span>
      {#each one.organization as org (org)}
        <span class="also">{org}</span>
      {/each}
    </span>
  {/snippet}
  {#snippet how()}
    <Glyph icon={secure ? Lock : TriangleAlert} />
    <span class="said">{secure ? 'Connection is secure' : 'Connection is not secure'}</span>
  {/snippet}

  {#if https}
    <button
      class="orden-button is-quiet how"
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
    <section class="certificate" aria-label="Certificate">
      {#if certificate && shown}
        <ol class="chain" aria-label="Certificate chain">
          {#each certificate.chain as link, index (index)}
            <li>
              <button
                class="orden-row link"
                class:is-on={index === at}
                aria-pressed={index === at}
                data-role={role(link, index)}
                onclick={() => (chosen = index)}
              >
                <span class="who">
                  <span class="name">{link.to.name}</span>
                  <span class="orden-row-meta">
                    <Facts parts={[ROLES[role(link, index)](), ...link.to.organization]} />
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ol>
        {#if certificate.separately}
          <p class="note">
            Read from the site separately: the browser engine does not say which certificate this page came with.
          </p>
        {/if}
        <dl class="details">
          <dt>Issued to</dt>
          <dd>{@render party(shown.to)}</dd>
          <dt>Issued by</dt>
          <dd>{@render party(shown.by)}</dd>
          <dt>Valid from</dt>
          <dd>{day(shown.from)}</dd>
          <dt>Valid until</dt>
          <dd>{day(shown.until)}</dd>
        </dl>
        {#each [{ label: 'Serial number', value: shown.serial }, { label: 'SHA-256 fingerprint', value: shown.sha256 }] as code (code.label)}
          <div class="code">
            <div class="head">
              <span class="label">{code.label}</span>
              <CopyButton value={code.value} />
            </div>
            <code class="hex" dir="ltr">{breakable(code.value)}</code>
          </div>
        {/each}
      {:else if asked}
        <p class="note">The certificate could not be read.</p>
      {/if}
    </section>
  {/if}

  {#if decided.length}
    <ul class="grants">
      {#each decided as ask (ask)}
        <li>
          <span>{ASK_NAMES[ask]}</span>
          <button
            class="orden-button is-quiet"
            onclick={() => grants.remember(site, ask, said[ask] === 'allow' ? 'block' : 'allow', privately)}
          >
            {said[ask] === 'allow' ? 'Allowed' : 'Blocked'}
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
      Reset permissions
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
  .site.wide {
    width: min(26rem, calc(100% - var(--space-4)));
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
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--text-muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .how > .chevron.open {
    transform: rotate(90deg);
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
  .link {
    min-height: 0;
    padding-block: var(--space-1);
  }
  .who {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .who > .name {
    color: var(--text-strong);
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
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: var(--space-3);
    row-gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
  .details > dt {
    color: var(--text-muted);
  }
  .details > dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .lines {
    display: flex;
    flex-direction: column;
  }
  .lines > .also {
    color: var(--text-muted);
  }
  .code {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
  .code > .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .code .label {
    color: var(--text-muted);
  }
  .hex {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
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
