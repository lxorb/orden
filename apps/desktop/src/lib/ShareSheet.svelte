<script lang="ts">
  import Facts from './Facts.svelte'
  import { fileMark } from './file-mark'
  import { t } from './i18n.svelte'
  import { shownName } from './note-name'
  import { nameOf } from './space-paths'
  import { isShared, share } from './sharing.svelte'
  import { called } from './person'
  import type { GivenRole, Member, Sharing } from './api'
  import Copyable from './Copyable.svelte'
  import FileMark from './FileMark.svelte'
  import Select from './Select.svelte'
  import Sheet from './Sheet.svelte'
  import SpaceMark from './SpaceMark.svelte'
  import { initial } from './icons'
  import type { Face } from './people/face'
  import { dur, fade, scale } from './motion'

  const ROLES = $derived([
    { value: 'write', label: t('can edit') },
    { value: 'read', label: t('can view') },
  ])

  const who = $derived(share.who)
  const link = $derived(who?.link ?? null)

  const item = $derived(share.item)

  const subject = $derived(item ? shownName(nameOf(item.path)) : (share.space?.name ?? ''))

  const alreadyInTheSpace = $derived(!!share.space && isShared(share.space.root))

  type Waiting = Sharing['requests'][number]

  function name(person: Member | Waiting): string {
    return person.email ? called({ name: person.name, email: person.email }) : (person.name ?? '')
  }

  function subtitle(person: Member): (string | null | false)[] {
    if (person.guest) return [person.email, t('Guest')]
    return [person.email, person.pending && t('Invited')]
  }

  const keyOf = (person: Member | Waiting) => `person:${person.guest ?? person.email ?? ''}`

  const faceOf = (person: Member | Waiting | Sharing['owner'], named: string): Face => ({
    name: named,
    avatar: person.avatar ?? null,
    key: person.id ?? person.email ?? ('guest' in person ? person.guest : null) ?? '',
  })

  const pressFor = (person: { id?: string | null }) => {
    const id = person.id
    return id && !__EVEN_PLUGIN__
      ? (event: MouseEvent) => {
          const from = event.currentTarget as Element
          void import('./people/card.svelte').then((card) => {
            card.showProfile(id, from, share.spaceId)
          })
        }
      : undefined
  }

  const avatars = __EVEN_PLUGIN__ ? null : import('./people/Avatar.svelte')

  function menuFor(person: Member) {
    return [
      ...ROLES,
      ...(person.pending && person.email ? [{ value: 'resend', label: t('Resend') }] : []),
      { value: 'remove', label: t('Remove'), danger: true },
    ]
  }

  function chose(person: Member, choice: string) {
    if (choice === 'remove') void share.remove(person)
    else if (choice === 'resend') void share.resend(person)
    else void share.setRole(person, choice as GivenRole)
  }

  function toggleLink() {
    if (share.busy) return
    if (link) void share.revoke()
    else void share.setLink('read', 'approval')
  }

  function toggleAsking() {
    if (!link || share.busy) return
    void share.setLink(link.role, link.mode === 'approval' ? 'open' : 'approval')
  }
</script>

{#snippet face(worn: Face, press: ((event: MouseEvent) => void) | undefined)}
  {#await avatars then got}
    {#if got}
      <got.default face={worn} onpress={press} />
    {:else}
      <span class="orden-badge" aria-hidden="true">{initial(worn.name)}</span>
    {/if}
  {/await}
{/snippet}

<Sheet open={share.open} title={t('Share {name}', { name: subject })} onclose={() => share.close()}>
  {#snippet mark()}
    {#if item}
      <FileMark mark={fileMark(item.path)} path={item.path} />
    {:else}
      <SpaceMark id={share.spaceId} name={share.space?.name ?? ''} />
    {/if}
  {/snippet}

  {#if share.error}
    <p class="wrong">{share.error}</p>
  {/if}

  {#if item && alreadyInTheSpace}
    <p class="note">{t('Everyone in the space already has it.')}</p>
  {/if}

  <div class="card">
    <form
      class="orden-field compose"
      class:bad={share.wrongAddress}
      onsubmit={(event) => {
        event.preventDefault()
        void share.invite()
      }}
    >
      <input
        data-lands
        bind:value={share.email}
        oninput={() => (share.wrongAddress = false)}
        type="text"
        inputmode="email"
        placeholder={t('Add people by email')}
        aria-label={t('Add people by email')}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
      />
      <div class="pick">
        <Select
          value={share.role}
          options={ROLES}
          onchange={(role: string) => (share.role = role as GivenRole)}
          label={t('Role')}
          plain
        />
      </div>
      {#if share.email.trim()}
        <button
          type="submit"
          class="send"
          aria-label={t('Invite')}
          title={t('Invite')}
          disabled={share.busy}
          transition:scale={{ duration: dur(130), start: 0.6 }}
        >
          <svg class="orden-mirror" viewBox="0 0 14 14"><path d="M2.5 7h9M7.6 3l4 4-4 4" /></svg>
        </button>
      {/if}
    </form>

    {#if share.wrongAddress}
      <p class="hint bad" transition:fade={{ duration: dur(130) }}>
        {t('enter a valid email address')}
      </p>
    {/if}

    {#if !who}
      <div aria-hidden="true">
        {#each [0, 1, 2] as row (row)}
          <div class="row person">
            <span class="bone face"></span>
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
        {#each who.requests as person (keyOf(person))}
          <div
            class="row person asking"
            class:waiting={share.waiting(keyOf(person))}
            transition:fade={{ duration: dur(130) }}
          >
            {@render face(faceOf(person, name(person)), pressFor(person))}
            <span class="name">
              {name(person)}
              <small>{person.email ?? t('Guest')}</small>
            </span>
            <button
              class="orden-chip"
              disabled={share.busy}
              onclick={() => void share.accept(person)}
            >
              {t('Accept')}
            </button>
            <button
              class="orden-chip is-quiet"
              disabled={share.busy}
              onclick={() => void share.decline(person)}
            >
              {t('Decline')}
            </button>
          </div>
        {/each}
      {/if}

      <h3>{t('Who has access')}</h3>

      <div class="row person">
        {@render face(faceOf(who.owner, called(who.owner)), pressFor(who.owner))}
        <span class="name">
          <span class="named"
            ><bdi class="who">{called(who.owner)}</bdi>
            <small class="you">{t('(you)')}</small></span
          >
          <small>{who.owner.email}</small>
        </span>
        <span class="fixed">{t('Owner')}</span>
      </div>

      {#each who.members as person (keyOf(person))}
        <div
          class="row person"
          class:waiting={share.waiting(keyOf(person))}
          transition:fade={{ duration: dur(130) }}
        >
          <span class="worn" class:pending={person.pending}>
            {@render face(faceOf(person, name(person)), pressFor(person))}
          </span>
          <span class="name">
            {name(person)}
            <small><Facts parts={subtitle(person)} /></small>
          </span>
          <div class="pick">
            <Select
              value={person.role}
              options={menuFor(person)}
              onchange={(choice: string) => chose(person, choice)}
              label={t('Role')}
              plain
              disabled={share.busy}
            />
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if who}
    <div class="card">
      <div
        class="row card-head"
        role="switch"
        tabindex="0"
        aria-checked={!!link}
        aria-label={t('Link')}
        onclick={toggleLink}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          toggleLink()
        }}
      >
        <span class="name">{t('Link')}</span>
        <span class="dot" class:on={!!link} aria-hidden="true"></span>
        <span class="orden-switch" class:on={!!link} aria-hidden="true"></span>
      </div>

      <hr class="line" />

      <div class="linkbody" class:off={!link}>
        <div class="row">
          <span class="orden-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
            </svg>
          </span>
          <span class="name">{t('Anyone with the link')}</span>
          <div class="pick">
            <Select
              value={link?.role ?? 'read'}
              options={ROLES}
              onchange={(role: string) =>
                void share.setLink(role as GivenRole, link?.mode ?? 'approval')}
              label={t('Role')}
              plain
              disabled={!link || share.busy}
            />
          </div>
        </div>

        <div
          class="row"
          role="switch"
          tabindex={link ? 0 : -1}
          aria-checked={link?.mode === 'approval'}
          aria-label={t('Ask first')}
          onclick={toggleAsking}
          onkeydown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            toggleAsking()
          }}
        >
          <span class="under" aria-hidden="true"></span>
          <span class="name asks">{t('Ask first')}</span>
          <span class="orden-switch" class:on={link?.mode === 'approval'} aria-hidden="true"></span>
        </div>

        <div class="row">
          <Copyable value={link?.url ?? ''} word={t('Copy link')} disabled={!link} />
        </div>

        <button
          class="orden-action is-danger"
          disabled={!link || share.busy}
          onclick={() => link && void share.reset(link.role, link.mode)}
        >
          {t('Reset link')}
        </button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .compose {
    padding: 3px 3px 3px var(--space-3);
    gap: var(--space-1);
  }

  .compose.bad {
    border-color: var(--danger);
  }

  .send {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-row);
    background: var(--accent);
    color: var(--accent-ink);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .send svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .send:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .person {
    padding: var(--space-1) 0;
  }

  .worn {
    display: contents;
  }

  .worn.pending > :global(*) {
    opacity: 0.45;
  }

  .asking {
    margin: 0 calc(-1 * var(--space-1)) 2px;
    padding: var(--space-1);
    border-radius: var(--radius-row);
    background: var(--accent-soft);
  }

  .waiting {
    opacity: 0.55;
  }

  .named {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
  }

  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .you {
    flex: none;
    color: var(--muted);
  }

  .fixed {
    flex: none;
    padding-inline-end: var(--space-1);
    color: var(--muted);
  }

  .pick {
    flex: none;
    max-width: 50%;
  }

  .card-head .name {
    flex: none;
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    margin-inline-end: auto;
    border-radius: 50%;
    background: var(--line-strong);
    transition: background var(--dur-base) var(--ease-out);
  }

  .dot.on {
    background: var(--success);
  }

  .linkbody {
    display: flex;
    flex-direction: column;
    width: 100%;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .linkbody.off {
    opacity: 0.45;
    pointer-events: none;
  }

  .asks {
    color: var(--muted-strong);
  }

  .under {
    flex: none;
    width: var(--row-height-sm);
  }

  .bone {
    display: block;
    height: 9px;
    border-radius: 4px;
    background: var(--surface-3);
    animation: bone-breathe 1400ms var(--ease-in-out) infinite;
  }

  .bone.face {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
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
    width: 64px;
    height: 12px;
    border-radius: 4px;
  }

  @keyframes bone-breathe {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bone {
      animation: none;
    }
  }

  :global([data-touch]) .compose {
    padding: var(--space-1) var(--space-1) var(--space-1) var(--touch-gap);
  }

  :global([data-touch]) .compose .pick {
    max-width: 40%;
  }

  :global([data-touch]) .send {
    width: var(--touch-target);
    height: var(--touch-target);
    border-radius: var(--radius-md);
  }

  :global([data-touch]) .send svg {
    width: var(--icon-md);
    height: var(--icon-md);
  }

  :global([data-touch]) .pick {
    max-width: 45%;
  }
</style>
