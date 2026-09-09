<script lang="ts">
  /** Who else is in a space: the people and what each may do, the address field
   *  that puts somebody new in, the one link, and whoever is waiting to be let
   *  in. One sheet, because they are one question. */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { t } from './i18n.svelte'
  import { share } from './sharing.svelte'
  import { called } from './person'
  import { viewport } from './viewport.svelte'
  import type { GivenRole, Member, Sharing } from './api'
  import Copyable from './Copyable.svelte'
  import Select from './Select.svelte'
  import { dur } from './motion'

  const ROLES = $derived([
    { value: 'write', label: t('Edit') },
    { value: 'read', label: t('Read') },
  ])

  const who = $derived(share.who)
  const link = $derived(who?.link ?? null)

  /** Somebody waiting to be let in, of either kind. */
  type Waiting = Sharing['requests'][number]

  // Escape closes it, like everything else the app puts over a note.
  $effect(() => (share.open ? overlays.show(() => share.close()) : undefined))
  $effect(() => closeOnBack(share.open, () => share.close()))

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

{#if share.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: dur(130) }} onclick={() => share.close()}></div>

  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label={t('Share {name}', { name: share.space?.name ?? '' })}
    transition:scale={{ duration: dur(190), start: 0.97, easing: cubicOut }}
  >
    <p class="title">{t('Share {name}', { name: share.space?.name ?? '' })}</p>

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
            <div class="nib-segmented" role="radiogroup" aria-label={t('Link')}>
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
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 50;
  }

  .sheet {
    position: fixed;
    top: 14vh;
    left: 50%;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(27rem, calc(100vw - 3rem));
    max-height: 72vh;
    overflow-y: auto;
    z-index: 51;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  .title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 550;
    color: var(--text-strong);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* Name on the left, what they may do on the right, one line each - the same
     row the settings draw. */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 38px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name small {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A row waiting on the server it was told to change. Not disabled-looking:
     every button in the sheet is already disabled while one is in flight, and
     this is which of them the answer is about. */
  .row.waiting {
    opacity: 0.55;
  }

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

  .invite input {
    flex: 1;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .invite input:focus {
    border-color: var(--accent);
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

  /* An action in a card: full width, quiet until pointed at. */
  .action {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    text-align: left;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .action:hover {
      color: var(--text-strong);
    }

    .action.danger:hover {
      color: var(--danger);
    }
  }

  /* A small action at the end of a row, where the control would be. */
  .pill {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .pill.quiet {
    border-color: transparent;
    color: var(--muted);
  }

  @media (hover: hover) {
    .pill:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .pill.quiet:hover {
      border-color: transparent;
      color: var(--text-strong);
    }
  }

  .pill:active {
    background: var(--accent-soft);
  }

  .primary {
    flex: none;
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .primary:active:not(:disabled) {
    background: var(--accent-press);
  }

  .primary:disabled {
    opacity: 0.5;
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: calc(var(--space-4) + var(--inset-bottom));
  }

  :global([data-touch]) .row {
    min-height: var(--touch-target);
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
