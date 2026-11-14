<script lang="ts">
  import type { VaultMeta } from '@orden/pass/types'
  import type { Invite } from '@orden/pass/wire'
  import { message } from '../../ui-kit/src/api'
  import { said } from '../../said.svelte'
  import { roleName } from '../../pass-sync/src/api'
  import { pass } from '../../pass-sync/src/api'
  import { passSync } from '../../pass-sync/src/api'
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
    const name = metas[invite.vault]?.name ?? 'the vault'
    try {
      if (accept) await pass.acceptInvite(invite)
      else await pass.declineInvite(invite.vault)
      passSync.invites = passSync.invites.filter((one) => one.vault !== invite.vault)
      said.say(accept ? `You joined ${name}` : 'Invitation declined')
      void passSync.refresh()
    } catch (error) {
      wrong = message(error, 'The invitation could not be answered.')
    } finally {
      busy = null
    }
  }
</script>

{#if invites.length}
  <section class="invites" aria-label="Invitations">
    <h3 class="orden-section">Invitations</h3>
    {#each invites as invite (invite.vault)}
      {@const meta = metas[invite.vault] ?? null}
      <div class="invite" data-invite={invite.vault}>
        {#if meta}<VaultMark color={meta.color} icon={meta.icon} mark={meta.mark} />{/if}
        <span class="what">
          <span class="name">{meta?.name ?? 'A shared vault'}</span>
          <span class="meta">{fromOf(invite)} invited you: {roleName(invite.role)}</span>
          {#if codes[invite.vault]}
            <span class="meta" data-inviter-code
              >Their safety code: {codes[invite.vault] ?? ''}</span
            >
          {/if}
          {#if invite.key === null}
            <span class="meta">Waiting for them to confirm you</span>
          {/if}
        </span>
        <div class="buttons">
          <button
            class="orden-button is-quiet is-soft"
            type="button"
            disabled={busy !== null}
            onclick={() => void answered(invite, false)}>Decline</button
          >
          <button
            class="orden-button"
            type="button"
            disabled={busy !== null || invite.key === null}
            onclick={() => void answered(invite, true)}>Accept</button
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
