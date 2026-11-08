<script lang="ts">
  import type { Member } from '@orden/pass/wire'
  import UserMinus from 'lucide/dist/esm/icons/user-minus.mjs'
  import { account } from '../account.svelte'
  import { message, t } from '../i18n.svelte'
  import { prompt } from '../prompt.svelte'
  import { said } from '../said.svelte'
  import Select from '../Select.svelte'
  import Sheet from '../Sheet.svelte'
  import Glyph from './Glyph.svelte'
  import type { Person } from './people'
  import type { InvitedRole } from './share'
  import { emailOf } from './share'
  import { hidesPasswords, mayHandOn, mayManage } from './share-rules'
  import { INVITED_ROLES, roleName, stateName } from './share-words'
  import { pass } from './store.svelte'
  import SwitchRow from './SwitchRow.svelte'
  import type { PassUi } from './ui.svelte'
  import VaultMark from './VaultMark.svelte'

  const { ui }: { ui: PassUi } = $props()

  const SETTLE = 500
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  let members = $state.raw<Member[]>([])
  let reading = $state(false)
  let email = $state('')
  let role = $state<InvitedRole>('viewer')
  let person = $state.raw<Person | undefined>(undefined)
  let codes = $state.raw<Record<string, Person>>({})
  let busy = $state(false)
  let wrong = $state('')

  const asked = $derived(ui.sheet?.kind === 'share' ? ui.sheet : null)
  const vault = $derived(asked ? (pass.vaults.find((one) => one.id === asked.vault) ?? null) : null)
  const signedIn = $derived(account.user !== null)
  const me = $derived(emailOf(account.user?.email ?? ''))
  const managing = $derived(vault !== null && mayManage(vault))
  const owning = $derived(vault !== null && mayHandOn(vault))
  const roles = $derived(INVITED_ROLES.map((one) => ({ value: one, label: roleName(one) })))
  const heirs = $derived(
    members.filter((one) => one.state === 'active' && one.role !== 'owner' && one.email !== me),
  )

  const close = () => (ui.sheet = null)
  const nameOf = (member: Member) => member.name || member.email
  const changeable = (member: Member) => managing && member.role !== 'owner' && member.email !== me

  async function reread(id: string) {
    reading = true
    try {
      members = await pass.members(id)
    } catch (error) {
      wrong = message(error, 'The members could not be read.')
    } finally {
      reading = false
    }
  }

  const vaultId = $derived(asked?.vault ?? null)

  $effect(() => {
    const id = vaultId
    members = []
    codes = {}
    email = ''
    role = 'viewer'
    wrong = ''
    if (!id || !signedIn) return
    void reread(id)
  })

  $effect(() => {
    const typed = email.trim()
    person = undefined
    if (!signedIn || !EMAIL.test(typed)) return
    let current = true
    const timer = setTimeout(() => {
      pass
        .person(typed)
        .then((found) => {
          if (current) person = found
        })
        .catch(() => undefined)
    }, SETTLE)
    return () => {
      current = false
      clearTimeout(timer)
    }
  })

  async function acted(run: () => Promise<void>, fallback: string) {
    if (!vault || busy) return
    busy = true
    wrong = ''
    try {
      await run()
      await reread(vault.id)
    } catch (error) {
      wrong = message(error, fallback)
    } finally {
      busy = false
    }
  }

  function invited(event: SubmitEvent) {
    event.preventDefault()
    const to = email.trim()
    const asked = person
    if (!vault || !EMAIL.test(to) || asked?.email !== emailOf(to)) return
    const id = vault.id
    void acted(async () => {
      await pass.invite(id, asked, role)
      email = ''
      said.say(t('Invitation sent to {email}', { email: to }))
    }, 'The invitation could not be sent.')
  }

  async function matched(found: Person) {
    try {
      const sure = await pass.codesMatch(found)
      if (person?.email === sure.email) person = sure
      if (sure.email in codes) codes = { ...codes, [sure.email]: sure }
      return sure
    } catch (error) {
      wrong = message(error, 'The safety code could not be kept.')
      return null
    }
  }

  async function confirmed(member: Member) {
    const id = vault?.id ?? ''
    const found = codes[member.email] ?? (await pass.memberPerson(member).catch(() => null))
    if (!found) return
    if (found.known !== 'confirmed') {
      codes = { ...codes, [member.email]: found }
      return
    }
    void acted(() => pass.confirmMember(id, found), 'They could not be confirmed.')
  }

  async function matchedMember(member: Member, found: Person) {
    const sure = await matched(found)
    if (sure && member.state === 'confirm') await confirmed(member)
  }

  function roleChanged(member: Member, next: string) {
    const id = vault?.id ?? ''
    void acted(
      () => pass.setRole(id, member.email, next as InvitedRole),
      'The role could not be changed.',
    )
  }

  async function removed(member: Member) {
    if (!vault) return
    const sure = await prompt.confirm({
      until: pass.opened,
      title: t('Remove {name}?', { name: nameOf(member) }),
      detail: t('The vault gets a new key. What they kept from before stays readable to them.'),
      confirmLabel: t('Remove'),
      danger: true,
    })
    if (!sure) return
    const id = vault.id
    await acted(() => pass.removeMember(id, member.email), 'They could not be removed.')
  }

  async function shownCode(member: Member) {
    if (member.email in codes) {
      codes = Object.fromEntries(Object.entries(codes).filter(([one]) => one !== member.email))
      return
    }
    try {
      codes = { ...codes, [member.email]: await pass.memberPerson(member) }
    } catch (error) {
      wrong = message(error, 'The safety code could not be read.')
    }
  }

  async function handedOn() {
    if (!vault) return
    const to = await prompt.choose({
      until: pass.opened,
      title: t('Transfer ownership to'),
      options: heirs.map((one) => ({ id: one.email, label: nameOf(one) })),
    })
    if (!to) return
    const heir = heirs.find((one) => one.email === to)
    const sure = await prompt.confirm({
      until: pass.opened,
      title: t('Make {name} the owner?', { name: heir ? nameOf(heir) : to }),
      detail: t('You stay a manager of the vault.'),
      confirmLabel: t('Transfer'),
    })
    if (!sure) return
    const id = vault.id
    await acted(() => pass.transfer(id, to), 'The vault could not be handed on.')
  }

  async function left() {
    if (!vault) return
    const sure = await prompt.confirm({
      until: pass.opened,
      title: t('Leave {vault}?', { vault: vault.name }),
      detail: t('Its items leave this device. Somebody who manages it can invite you again.'),
      confirmLabel: t('Leave'),
      danger: true,
    })
    if (!sure) return
    const id = vault.id
    busy = true
    try {
      await pass.leave(id)
      close()
      await ui.choose({ kind: 'all' })
    } catch (error) {
      wrong = message(error, 'You could not leave the vault.')
    } finally {
      busy = false
    }
  }

  function hidden(on: boolean) {
    const id = vault?.id ?? ''
    void acted(
      () => pass.updateVault(id, { hidePasswordsFromViewers: on }),
      'The vault could not be kept.',
    )
  }
</script>

{#snippet safety(found: Person | undefined, match: (found: Person) => void)}
  {#if found?.code === null}
    <p class="quiet" data-safety>
      {t('They have not set up Pass yet. Confirm them here once they have.')}
    </p>
  {:else if found}
    {#if found.known === 'changed'}
      <p class="wrong" role="alert" data-changed>
        {t('Their key is not the one this device knew. Check their safety code with them again.')}
      </p>
    {/if}
    <p class="safety" data-safety>
      <span class="quiet">{t('Safety code')}</span>
      <code dir="ltr">{found.code}</code>
      {#if found.known === 'confirmed'}
        <span class="quiet" data-matched>{t('Checked')}</span>
      {:else}
        <button
          class="orden-button is-soft"
          type="button"
          disabled={busy}
          onclick={() => match(found)}>{t('Codes match')}</button
        >
      {/if}
    </p>
  {/if}
{/snippet}

<Sheet
  open={asked !== null}
  title={vault ? t('Share {vault}', { vault: vault.name }) : t('Share')}
  onclose={close}
>
  {#snippet mark()}
    {#if vault}<VaultMark color={vault.color} icon={vault.icon} mark={vault.mark} />{/if}
  {/snippet}
  <div class="share">
    {#if !signedIn}
      <p class="quiet" data-signed-out>{t('Sign in to share')}</p>
    {:else if vault}
      {#if managing}
        <form class="invite" onsubmit={invited}>
          <input
            class="orden-field is-value"
            type="email"
            autocomplete="off"
            placeholder={t('Email address')}
            aria-label={t('Email address')}
            bind:value={email}
            data-lands
          />
          <Select
            label={t('Role')}
            value={role}
            options={roles}
            onchange={(next: string) => (role = next as InvitedRole)}
          />
          <button class="orden-button" type="submit" disabled={busy || !EMAIL.test(email.trim())}
            >{t('Invite')}</button
          >
        </form>
        {@render safety(person, (found) => void matched(found))}
        {#if person?.code}
          <p class="quiet">
            {person.known === 'confirmed'
              ? t('Pass gives them the vault’s key when you invite them.')
              : t(
                  'Read it to them. Only once you press Codes match does Pass give them the vault’s key.',
                )}
          </p>
        {/if}
      {/if}

      <h3 class="orden-section">{t('Members')}</h3>
      <div class="card members" aria-busy={reading}>
        {#each members as member (member.email)}
          <div class="member" data-member={member.email}>
            <div class="orden-setting row">
              <span class="who">
                <span class="name"
                  >{nameOf(member)}{member.email === me ? ` (${t('you')})` : ''}</span
                >
                {#if member.name}<span class="email">{member.email}</span>{/if}
                <span class="state" data-state={member.state}
                  >{stateName(member.state, managing)}</span
                >
              </span>
              {#if changeable(member)}
                <div class="pick">
                  <Select
                    label={t('Role of {name}', { name: nameOf(member) })}
                    value={member.role}
                    options={roles}
                    disabled={busy}
                    onchange={(next: string) => roleChanged(member, next)}
                  />
                </div>
              {:else}
                <span class="text role">{roleName(member.role)}</span>
              {/if}
              {#if member.state === 'confirm' && managing}
                <button
                  class="orden-chip"
                  type="button"
                  disabled={busy}
                  onclick={() => void confirmed(member)}>{t('Confirm')}</button
                >
              {/if}
              {#if member.pub !== null && member.email !== me}
                <button
                  class="orden-chip"
                  type="button"
                  aria-pressed={member.email in codes}
                  onclick={() => void shownCode(member)}>{t('Safety code')}</button
                >
              {/if}
              {#if changeable(member)}
                <button
                  class="orden-glyph"
                  type="button"
                  disabled={busy}
                  aria-label={t('Remove {name}', { name: nameOf(member) })}
                  title={t('Remove {name}', { name: nameOf(member) })}
                  onclick={() => void removed(member)}
                >
                  <Glyph icon={UserMinus} />
                </button>
              {/if}
            </div>
            {#if member.email in codes}
              <div class="code">
                {@render safety(codes[member.email], (found) => void matchedMember(member, found))}
              </div>
            {/if}
          </div>
        {:else}
          <p class="quiet empty">{reading ? t('Reading…') : t('Only you')}</p>
        {/each}
      </div>

      {#if managing}
        <div class="card">
          <SwitchRow
            label={t('Hide passwords from viewers')}
            on={vault.hidePasswordsFromViewers}
            disabled={busy}
            onchange={hidden}
          />
        </div>
      {:else if hidesPasswords(vault)}
        <p class="quiet">{t('Passwords in this vault are hidden from you.')}</p>
      {/if}

      {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}

      <div class="buttons">
        {#if owning}
          <button
            class="orden-button is-quiet"
            type="button"
            disabled={busy || heirs.length === 0}
            onclick={() => void handedOn()}>{t('Transfer ownership')}</button
          >
        {:else}
          <button
            class="orden-button is-quiet danger"
            type="button"
            disabled={busy}
            onclick={() => void left()}>{t('Leave vault')}</button
          >
        {/if}
      </div>
    {/if}
  </div>
</Sheet>

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-2);
  }

  .invite {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--space-2);
    align-items: center;
  }

  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .member + .member {
    border-top: 1px solid var(--line);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .pick {
    flex: none;
    width: 8.5rem;
  }

  .who {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
  }

  .name {
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .email,
  .state,
  .role,
  .quiet {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .state[data-state='confirm'] {
    color: var(--text-strong);
  }

  .code {
    padding: 0 var(--space-3) var(--space-2);
  }

  .safety {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0;
  }

  .safety code {
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    -webkit-user-select: all;
    user-select: all;
  }

  .quiet {
    margin: 0;
  }

  .empty {
    padding: var(--space-2) var(--space-3);
  }

  .wrong {
    margin: 0;
    color: var(--danger);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
  }

  .danger {
    color: var(--danger);
  }

  @media (max-width: 520px) {
    .invite {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .invite input {
      grid-column: 1 / -1;
    }
  }
</style>
