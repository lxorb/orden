<script lang="ts">
  import { Facts } from '../../ui-kit/src/api'
  import { type share as shareStore, whoIs } from '../../sharing/src/api'
  import { account, called } from '../../accounts/src/api'
  import type { Face, Member, MemberRole, Sharing } from '../../accounts/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { dur, fade } from '../../platform/src/api'

  const { store, manages, titled = true }: { store: typeof shareStore; manages: boolean; titled?: boolean } = $props()
  const ROLES = [
    { value: 'write', label: 'Write' },
    { value: 'read', label: 'View' },
  ]
  const ADMIN = { value: 'admin', label: 'Admin' }
  const who = $derived(store.who)
  const whole = $derived(store.item === null)
  const mine = $derived(
    !!who &&
      !!account.user &&
      (who.owner.id ? who.owner.id === account.user.id : who.owner.email === account.user.email),
  )
  type Waiting = Sharing['requests'][number]
  function name(person: Member | Waiting): string {
    return person.email ? called({ name: person.name, email: person.email }) : (person.name ?? '')
  }
  function subtitle(person: Member): (string | null | false)[] {
    if (person.guest) return [person.email, 'Guest']
    return [person.email, person.pending && 'Invited']
  }
  const faceOf = (person: Member | Waiting | Sharing['owner'], named: string): Face => ({
    name: named,
    avatar: person.avatar ?? null,
    key: person.id ?? person.email ?? ('guest' in person ? person.guest : null) ?? '',
  })
  const pressFor = (person: { id?: string | null }) => {
    const id = person.id
    return id
      ? (event: MouseEvent) => {
          const from = event.currentTarget as Element
          void import('./card.svelte').then((card) => {
            card.showProfile(id, from, store.spaceId)
          })
        }
      : undefined
  }
  const avatars = import('./Avatar.svelte')
  const roleOf = (person: Member) => (person.admin ? 'admin' : person.role)
  function menuFor(person: Member) {
    return [
      ...ROLES,
      ...(whole && !person.guest ? [ADMIN] : []),
      ...(person.pending && person.email ? [{ value: 'resend', label: 'Resend' }] : []),
      { value: 'remove', label: 'Remove', danger: true },
    ]
  }
  function chose(person: Member, choice: string) {
    if (choice === 'remove') void store.remove(person)
    else if (choice === 'resend') void store.resend(person)
    else void store.setRole(person, choice as MemberRole)
  }
</script>

{#snippet face(worn: Face, press: ((event: MouseEvent) => void) | undefined)}
  {#await avatars then got}
    <got.default face={worn} onpress={press} />
  {/await}
{/snippet}

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
  {#if titled && who.requests.length}
    <h3>Waiting</h3>
    {#each who.requests as person (whoIs(person))}
      <div
        class="row person asking"
        class:waiting={store.waiting(whoIs(person))}
        transition:fade={{ duration: dur(130) }}
      >
        {@render face(faceOf(person, name(person)), pressFor(person))}
        <span class="name">
          {name(person)}
          <small>{person.email ?? 'Guest'}</small>
        </span>
        <button class="orden-chip" disabled={store.busy || !manages} onclick={() => void store.accept(person)}>
          Accept
        </button>
        <button
          class="orden-chip is-quiet"
          disabled={store.busy || !manages}
          onclick={() => void store.decline(person)}
        >
          Decline
        </button>
      </div>
    {/each}
  {/if}

  {#if titled}<h3>Who has access</h3>{/if}

  <div class="row person" class:orden-setting={!titled} class:setting={!titled}>
    {@render face(faceOf(who.owner, called(who.owner)), pressFor(who.owner))}
    <span class="name">
      <span class="named"
        ><bdi class="who">{called(who.owner)}</bdi>
        {#if mine}<small class="you">(you)</small>{/if}</span
      >
      <small>{who.owner.email}</small>
    </span>
    <span class="fixed text">Owner</span>
  </div>

  {#each who.members as person (whoIs(person))}
    <div
      class="row person"
      class:orden-setting={!titled}
      class:setting={!titled}
      class:waiting={store.waiting(whoIs(person))}
      transition:fade={{ duration: dur(130) }}
    >
      <span class="worn" class:pending={person.pending}>
        {@render face(faceOf(person, name(person)), pressFor(person))}
      </span>
      <span class="name">
        {name(person)}
        <small><Facts parts={subtitle(person)} /></small>
      </span>
      <div>
        <Select
          value={roleOf(person)}
          options={menuFor(person)}
          onchange={(choice: string) => chose(person, choice)}
          label="Role"
          plain
          disabled={store.busy || !manages}
        />
      </div>
    </div>
  {/each}
{/if}

<style>
  .name > small {
    display: block;
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .person:not(.setting) {
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
</style>
