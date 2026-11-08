<script lang="ts">
  import type { LinkRow } from '@orden/pass/wire'
  import Link from 'lucide/dist/esm/icons/link.mjs'
  import Trash from 'lucide/dist/esm/icons/trash-2.mjs'
  import { account } from '../account.svelte'
  import { message, plural, t } from '../i18n.svelte'
  import { said } from '../said.svelte'
  import Gate from './Gate.svelte'
  import Glyph from './Glyph.svelte'
  import ItemMark from './ItemMark.svelte'
  import { expiresIn, isExpired, viewsWord } from './link-words'
  import { links, removeExpired, removeLink } from './links'
  import { pass } from './store.svelte'

  const signedIn = $derived(account.user !== null)

  let rows = $state.raw<LinkRow[] | null>(null)
  let now = $state(Date.now())
  let busy = $state(false)
  let wrong = $state('')

  const expired = $derived((rows ?? []).filter((one) => isExpired(one, now)).length)
  const itemOf = (link: LinkRow) => pass.items.find((one) => one.id === link.item) ?? null

  async function reread() {
    wrong = ''
    try {
      const found = await links()
      now = Date.now()
      rows = [...found].sort((a, b) => b.created - a.created)
    } catch (error) {
      rows = rows ?? []
      wrong = message(error, 'The links could not be read.')
    }
  }

  $effect(() => {
    if (!signedIn) return
    void reread()
  })

  async function acted(run: () => Promise<void>) {
    if (busy) return
    busy = true
    try {
      await run()
      await reread()
    } catch (error) {
      wrong = message(error, 'The link could not be removed.')
    } finally {
      busy = false
    }
  }

  function removed(link: LinkRow) {
    void acted(() => removeLink(link.id))
  }

  function sweep() {
    void acted(async () => {
      const gone = await removeExpired()
      said.say(plural(gone, { one: '{count} link removed', other: '{count} links removed' }))
    })
  }
</script>

{#if !signedIn}
  <Gate icon={Link} title={t('Secure links')} line={t('Sign in to share')}>
    <span></span>
  </Gate>
{:else if rows !== null && rows.length === 0 && !wrong}
  <Gate icon={Link} title={t('Secure links')} line={t('No secure links yet')}>
    <span></span>
  </Gate>
{:else}
  <section class="links" aria-label={t('Secure links')} data-scrolls>
    <header class="head">
      <h2 class="title">{t('Secure links')}</h2>
      <button class="orden-chip" type="button" disabled={busy || expired === 0} onclick={sweep}
        >{t('Remove all expired links')}</button
      >
    </header>
    <p class="quiet">
      {t('A link’s key is never kept, so a link cannot be copied again. Make a new one instead.')}
    </p>
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
    {#if rows === null}
      <p class="quiet">{t('Reading…')}</p>
    {:else}
      <div class="card" role="list">
        {#each rows as link (link.id)}
          {@const item = itemOf(link)}
          {@const over = isExpired(link, now)}
          <div class="orden-setting row" role="listitem" data-link={link.id} class:is-over={over}>
            {#if item}<ItemMark content={item.content} />{/if}
            <span class="what">
              <span class="name"
                >{item ? item.content.title || t('Untitled') : t('Deleted item')}</span
              >
              <span class="meta">
                <span data-expires>{over ? t('Expired') : expiresIn(link.expires, now)}</span>
                <span data-views>{viewsWord(link)}</span>
              </span>
            </span>
            <button
              class="orden-glyph"
              type="button"
              disabled={busy}
              aria-label={t('Remove link')}
              title={t('Remove link')}
              onclick={() => removed(link)}
            >
              <Glyph icon={Trash} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .links {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-4) var(--space-5) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .title {
    margin: 0;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .row {
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .row + .row {
    border-top: 1px solid var(--line);
  }

  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .is-over .name {
    color: var(--muted);
  }

  .quiet {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  @media (max-width: 520px) {
    .links {
      padding: var(--space-3);
    }

    .head {
      flex-wrap: wrap;
    }
  }
</style>
