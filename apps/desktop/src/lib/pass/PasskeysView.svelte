<script lang="ts">
  import type { Item, Login } from '@orden/pass/types'
  import { atLeast } from '@orden/pass/types'
  import KeyRound from 'lucide/dist/esm/icons/key-round.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { i18n, t } from '../i18n.svelte'
  import { prompt } from '../prompt.svelte'
  import Glyph from './Glyph.svelte'
  import { pass } from './store.svelte'

  const { item, content }: { item: Item; content: Login } = $props()

  const role = $derived(pass.vaults.find((one) => one.id === item.vault)?.role ?? 'viewer')
  const editable = $derived(item.trashed === null && atLeast(role, 'editor'))

  async function remove(id: string, site: string) {
    const sure = await prompt.confirm({
      title: t('Remove the passkey for {site}?', { site }),
      detail: t('You will no longer be able to sign in with it.'),
      confirmLabel: t('Remove'),
      danger: true,
    })
    if (!sure) return
    await pass.update(item.id, {
      ...content,
      passkeys: content.passkeys.filter((one) => one.id !== id),
    })
  }
</script>

{#if content.passkeys.length}
  <section class="card" aria-label={t('Passkeys')}>
    <h3 class="nib-section">{t('Passkeys')}</h3>
    {#each content.passkeys as key (key.id)}
      <div class="line" data-passkey={key.rpId}>
        <Glyph icon={KeyRound} />
        <span class="words">
          <span class="user">{key.userName || key.userDisplayName || t('Passkey')}</span>
          <span class="meta"
            >{key.rpName || key.rpId}{key.created
              ? ` · ${i18n.when(key.created, { dateStyle: 'medium' })}`
              : ''}</span
          >
        </span>
        {#if editable}
          <button
            class="nib-glyph"
            type="button"
            aria-label={t('Remove the passkey for {site}', { site: key.rpId })}
            title={t('Remove')}
            onclick={() => void remove(key.id, key.rpName || key.rpId)}
          >
            <Glyph icon={X} />
          </button>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > .nib-section {
    margin: 0;
    padding: var(--space-3) var(--space-3) var(--space-1);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  }

  .line + .line {
    border-top: 1px solid var(--line);
  }

  .words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .user {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-row);
    color: var(--text);
  }

  .meta {
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
