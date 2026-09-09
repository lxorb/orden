<script lang="ts">
  /** Who else is in a space: the people and what each may do, the address field
   *  that puts somebody new in, the one link, and whoever is waiting to be let
   *  in. One sheet, because they are one question.
   *
   *  Drawn in the box every space sheet is drawn in; see Sheet.svelte. */
  import { fade } from 'svelte/transition'
  import { t } from './i18n.svelte'
  import { share } from './sharing.svelte'
  import { segmented } from './slide'
  import { called } from './person'
  import { viewport } from './viewport.svelte'
  import type { GivenRole, Member, Sharing } from './api'
  import Copyable from './Copyable.svelte'
  import Select from './Select.svelte'
  import Sheet from './Sheet.svelte'
  import { dur } from './motion'

  const ROLES = $derived([
    { value: 'write', label: t('Edit') },
    { value: 'read', label: t('Read') },
  ])

  const who = $derived(share.who)
  const link = $derived(who?.link ?? null)

  /** Somebody waiting to be let in, of either kind. */
  type Waiting = Sharing['requests'][number]

  /** What to call somebody in a list where a guest has no account to name them.
   *  A guest is given a name by their device and may change it, so there is
   *  always one; a member without an account yet is named by their address. */
  function name(person: Member | Waiting): string {
    return person.email ? called({ name: person.name, email: person.email }) : (person.name ?? '')
  }

  /** The line under the name. For a member it is the address, which is who they
   *  actually are, and whether anybody has opened the space under it yet. For a
   *  guest it is the word: a link is how they got here, and anything they typed
   *  about themselves is what they said rather than what was proved. */
  function subtitle(person: Member): string {
    if (person.guest) return person.email ? `${person.email} · ${t('Guest')}` : t('Guest')
    return person.pending ? `${person.email} · ${t('Invited')}` : (person.email ?? '')
  }

  /** What names a row, whichever kind of person it is. The same key the store
   *  says a request is about, so the row being changed is the row that shows it. */
  const keyOf = (person: Member | Waiting) => `person:${person.guest ?? person.email ?? ''}`
</script>

<Sheet
  open={share.open}
  title={t('Share {name}', { name: share.space?.name ?? '' })}
  onclose={() => share.close()}
>
  {#if share.error}
    <p class="wrong">{share.error}</p>
  {/if}

  {#if !who}
    <!-- The shape of the answer while it is on its way, so the sheet is
           already the size it is about to be and the rows arrive in place rather
           than pushing everything down as they land. -->
    <h3>{t('People')}</h3>
    <div class="card" aria-hidden="true">
      {#each [0, 1, 2] as row (row)}
        <div class="row">
          <span class="name">
            <span class="bone words"></span>
            <span class="bone under"></span>
          </span>
          <span class="bone control"></span>
        </div>
      {/each}
    </div>
  {:else}
    {#if who.requests.length}
      <h3>{t('Waiting')}</h3>
      <div class="card">
        {#each who.requests as person (keyOf(person))}
          <div
            class="row"
            class:waiting={share.waiting(keyOf(person))}
            transition:fade={{ duration: dur(130) }}
          >
            <span class="name">
              {name(person)}
              <small>{person.email ?? t('Guest')}</small>
            </span>
            <button class="pill" disabled={share.busy} onclick={() => void share.accept(person)}>
              {t('Accept')}
            </button>
            <button
              class="pill quiet"
              disabled={share.busy}
              onclick={() => void share.decline(person)}
            >
              {t('Decline')}
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <h3>{t('People')}</h3>
    <div class="card">
      <div class="row">
        <span class="name">
          {called(who.owner)}
          <small>{who.owner.email}</small>
        </span>
        <span class="fixed">{t('Owner')}</span>
      </div>

      {#each who.members as person (keyOf(person))}
        <div
          class="row"
          class:waiting={share.waiting(keyOf(person))}
          transition:fade={{ duration: dur(130) }}
        >
          <span class="name">
            {name(person)}
            <small>{subtitle(person)}</small>
          </span>
          <div class="pick">
            <Select
              value={person.role}
              options={ROLES}
              onchange={(role: string) => void share.setRole(person, role as GivenRole)}
              label={t('Role')}
              plain={viewport.touch}
              disabled={share.busy}
            />
          </div>
          <button
            class="shut"
            aria-label={t('Remove')}
            title={t('Remove')}
            disabled={share.busy}
            onclick={() => void share.remove(person)}
          >
            <svg viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" /></svg>
          </button>
        </div>
      {/each}
    </div>

    <form
      class="invite"
      onsubmit={(event) => {
        event.preventDefault()
        void share.invite()
      }}
    >
      <input
        class="field"
        bind:value={share.email}
        type="email"
        placeholder={t('Email address')}
        spellcheck="false"
        autocomplete="off"
      />
      <div class="pick narrow">
        <Select
          value={share.role}
          options={ROLES}
          onchange={(role: string) => (share.role = role as GivenRole)}
          label={t('Role')}
        />
      </div>
      <button type="submit" class="primary" disabled={!share.email.trim() || share.busy}>
        {t('Invite')}
      </button>
    </form>

    <h3>{t('Link')}</h3>
    {#if link}
      <div class="card">
        <div class="linkrow">
          <Copyable value={link.url} />
        </div>

        <div class="row">
          <div class="nib-segmented" role="radiogroup" aria-label={t('Link')} use:segmented>
            <button
              type="button"
              role="radio"
              aria-checked={link.mode === 'open'}
              class:on={link.mode === 'open'}
              disabled={share.busy}
              onclick={() => void share.setLink(link.role, 'open')}
            >
              {t('Anyone')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={link.mode === 'approval'}
              class:on={link.mode === 'approval'}
              disabled={share.busy}
              onclick={() => void share.setLink(link.role, 'approval')}
            >
              {t('Ask first')}
            </button>
          </div>
          <div class="pick narrow">
            <Select
              value={link.role}
              options={ROLES}
              onchange={(role: string) => void share.setLink(role as GivenRole, link.mode)}
              label={t('Role')}
              disabled={share.busy}
            />
          </div>
        </div>

        <button class="action danger" disabled={share.busy} onclick={() => void share.revoke()}>
          {t('Revoke')}
        </button>
      </div>
    {:else}
      <button
        class="action"
        disabled={share.busy}
        onclick={() => void share.setLink('read', 'approval')}
      >
        {t('Make a link')}
      </button>
    {/if}
  {/if}
</Sheet>

<style>
  /* The shape of a row, while the rows themselves are on their way. Plain
     blocks where the words and the control will be: enough that the sheet is
     the right size and the wait reads as a wait rather than as an empty list. */
  .bone {
    display: block;
    height: 9px;
    border-radius: 4px;
    background: var(--surface-2);
    animation: bone-breathe 1400ms var(--ease-in-out) infinite;
  }

  .bone.words {
    width: 42%;
  }

  .bone.under {
    width: 58%;
    height: 8px;
    margin-top: 4px;
    opacity: 0.7;
  }

  .bone.control {
    flex: none;
    width: 84px;
    height: 26px;
    border-radius: var(--radius-sm);
  }

  @keyframes bone-breathe {
    50% {
      opacity: 0.45;
    }
  }

  /* Still, where movement is turned down: the blocks are the shape of the
     answer, and they say that on their own. */
  @media (prefers-reduced-motion: reduce) {
    .bone {
      animation: none;
    }
  }

  /* A row waiting on the server it was told to change. Not disabled-looking:
     every button in the sheet is already disabled while one is in flight, and
     this is which of them the answer is about. */
  .row.waiting {
    opacity: 0.55;
  }

  /* The owner, whose role is the space rather than a choice. */
  .fixed {
    flex: none;
    padding-right: 6px;
    color: var(--muted-strong);
  }

  .pick {
    flex: none;
    width: 8rem;
  }

  .pick.narrow {
    width: 6.5rem;
  }

  /* Taking somebody out: the same cross a tab closes with. */
  .shut {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .shut svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  @media (hover: hover) {
    .shut:hover {
      background: var(--surface-2);
      color: var(--danger);
    }
  }

  .invite {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    margin-top: var(--space-2);
  }

  /* The one copy row the app has, given the space this card wants around it;
     see Copyable.svelte. */
  .linkrow {
    margin-bottom: var(--space-2);
  }

  /* The segmented control is one shape for the whole app; see .nib-segmented in
     the themes package. Here it only has to take the width the row leaves. */
  .nib-segmented {
    flex: 1;
  }

  /* The address and its role need the width on a phone, so the button goes
     under them rather than the three of them sharing one line. */
  :global([data-touch]) .invite {
    flex-wrap: wrap;
  }

  :global([data-touch]) .invite .primary {
    flex: 1;
  }
</style>
