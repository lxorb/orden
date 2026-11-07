<script lang="ts">
  import type { VaultMeta } from '@orden/pass/types'
  import type { Invite } from '@orden/pass/wire'
  import { message, t } from '../i18n.svelte'
  import { said } from '../said.svelte'
  import { roleName } from './share-words'
  import { pass } from './store.svelte'
  import { passSync } from './syncing.svelte'
  import VaultMark from './VaultMark.svelte'

  const invites = $derived(passSync.invites)

  let metas = $state.raw<Record<string, VaultMeta | null>>({})
  let codes = $state.raw<Record<string, string | null>>({})
  let busy = $state<string | null>(null)
  let wrong = $state('')

  $effect(() => {
    const now = invites
    let current = true
    void Promise.all(
      now.map(async (one) => [one.vault, await pass.inviteMeta(one).catch(() => null)] as const),
    ).then((found) => {
      if (current) metas = Object.fromEntries(found)
    })
    void Promise.all(
      now.map(async (one) => [one.vault, await pass.inviterCode(one).catch(() => null)] as const),
    ).then((found) => {
      if (current) codes = Object.fromEntries(found)
    })
    return () => {
      current = false
    }
  })

  const fromOf = (invite: Invite) =>
    invite.fromName ? `${invite.fromName} (${invite.from})` : invite.from

  async function answered(invite: Invite, accept: boolean) {
    if (busy !== null) return
    busy = invite.vault
    wrong = ''
    const name = metas[invite.vault]?.name ?? t('the vault')
    try {
      if (accept) await pass.acceptInvite(invite)
      else await pass.declineInvite(invite.vault)
      passSync.invites = passSync.invites.filter((one) => one.vault !== invite.vault)
      said.say(accept ? t('You joined {vault}', { vault: name }) : t('Invitation declined'))
      void passSync.refresh()
    } catch (error) {
      wrong = message(error, 'The invitation could not be answered.')
    } finally {
      busy = null
    }
  }
</script>

{#if invites.length}
  <section class="invites" aria-label={t('Invitations')}>
    <h3 class="orden-section">{t('Invitations')}</h3>
    {#each invites as invite (invite.vault)}
      {@const meta = metas[invite.vault] ?? null}
      <div class="invite" data-invite={invite.vault}>
        {#if meta}<VaultMark color={meta.color} icon={meta.icon} mark={meta.mark} />{/if}
        <span class="what">
          <span class="name">{meta?.name ?? t('A shared vault')}</span>
          <span class="meta"
            >{t('{from} invited you: {role}', {
              from: fromOf(invite),
              role: roleName(invite.role),
            })}</span
          >
          {#if codes[invite.vault]}
            <span class="meta" data-inviter-code
              >{t('Their safety code: {code}', { code: codes[invite.vault] ?? '' })}</span
            >
          {/if}
          {#if invite.key === null}
            <span class="meta">{t('Waiting for them to confirm you')}</span>
          {/if}
        </span>
        <div class="buttons">
          <button
            class="orden-button is-quiet is-soft"
            type="button"
            disabled={busy !== null}
            onclick={() => void answered(invite, false)}>{t('Decline')}</button
          >
          <button
            class="orden-button"
            type="button"
            disabled={busy !== null || invite.key === null}
            onclick={() => void answered(invite, true)}>{t('Accept')}</button
          >
        </div>
      </div>
    {/each}
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
  </section>
{/if}

<style>
  .invites {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-2) var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .orden-section {
    margin: var(--space-2) 0 0;
    padding: 0 var(--space-2);
  }

  .invite {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .what {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
  }

  .name {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .meta {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .buttons {
    display: flex;
    gap: var(--space-1);
    margin-inline-start: auto;
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }
</style>
