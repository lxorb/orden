<script lang="ts">
  import { fileMark } from '../../marks/src/api'
  import { nameOf, shownName } from '../../platform/src/api'
  import { isShared, share } from '../../sharing/src/api'
  import type { GivenRole, MemberRole } from '../../accounts/src/api'
  import { Copyable, QrCode, Select, Sheet } from '../../ui-controls/src/api'
  import { FileMark, SpaceMark } from '../../marks/src/api'
  import { dur, fade, scale } from '../../platform/src/api'
  import MemberRows from './MemberRows.svelte'

  const ROLES = [
    { value: 'write', label: 'Write' },
    { value: 'read', label: 'View' },
  ]
  const who = $derived(share.who)
  const link = $derived(who?.link ?? null)
  const item = $derived(share.item)
  const inviting = $derived(item ? ROLES : [...ROLES, { value: 'admin', label: 'Admin' }])
  const subject = $derived(item ? shownName(nameOf(item.path)) : (share.space?.name ?? ''))
  const alreadyInTheSpace = $derived(!!share.space && isShared(share.space.root))
  function toggleLink() {
    if (share.busy) return
    if (link) void share.revoke()
    else void share.setLink('read', 'open')
  }
  const sharable = 'share' in navigator
  function shareLink(url: string) {
    navigator.share({ title: subject, url }).catch(() => undefined)
  }
  function toggleAsking() {
    if (!link || share.busy) return
    void share.setLink(link.role, link.mode === 'approval' ? 'open' : 'approval')
  }
</script>

<Sheet open={share.open} title="Share {subject}" onclose={() => share.close()}>
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
    <p class="note">Everyone in the space already has it.</p>
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
        disabled={share.full}
        oninput={() => (share.wrongAddress = false)}
        type="text"
        inputmode="email"
        placeholder="Add people by email"
        aria-label="Add people by email"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
      />
      <div class="pick">
        <Select
          value={share.role}
          options={inviting}
          onchange={(role: string) => (share.role = role as MemberRole)}
          label="Role"
          plain
        />
      </div>
      {#if share.email.trim()}
        <button
          type="submit"
          class="send"
          aria-label="Invite"
          title="Invite"
          disabled={share.busy || share.full}
          transition:scale={{ duration: dur(130), start: 0.6 }}
        >
          <svg viewBox="0 0 14 14"><path d="M2.5 7h9M7.6 3l4 4-4 4" /></svg>
        </button>
      {/if}
    </form>

    {#if share.wrongAddress}
      <p class="hint bad" transition:fade={{ duration: dur(130) }}>enter a valid email address</p>
    {/if}

    {#if share.seats}
      <p class="hint seats">{share.seats.used} of {share.seats.most} places used</p>
    {/if}

    {#if share.full}
      <p class="hint">This space is full. Remove someone to invite more.</p>
    {/if}

    <MemberRows store={share} manages />
  </div>

  {#if who}
    <div class="card">
      <div
        class="row card-head"
        role="switch"
        tabindex="0"
        aria-checked={!!link}
        aria-label="Link"
        onclick={toggleLink}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          toggleLink()
        }}
      >
        <span class="name">Link</span>
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
          <span class="name">Anyone with the link</span>
          <div class="pick">
            <Select
              value={link?.role ?? 'read'}
              options={ROLES}
              onchange={(role: string) => void share.setLink(role as GivenRole, link?.mode ?? 'open')}
              label="Role"
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
          aria-label="Ask first"
          onclick={toggleAsking}
          onkeydown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            toggleAsking()
          }}
        >
          <span class="under" aria-hidden="true"></span>
          <span class="name asks">Ask first</span>
          <span class="orden-switch" class:on={link?.mode === 'approval'} aria-hidden="true"></span>
        </div>

        <div class="row">
          <Copyable value={link?.url ?? ''} word="Copy link" disabled={!link} />
          {#if sharable}
            <button class="share" type="button" disabled={!link} onclick={() => link && shareLink(link.url)}>
              Share
            </button>
          {/if}
        </div>

        {#if link}
          <div class="reach">
            <QrCode value={link.url} label="QR code for the link" />
          </div>
        {/if}

        <button
          class="orden-action is-danger"
          disabled={!link || share.busy}
          onclick={() => link && void share.reset(link.role, link.mode)}
        >
          Reset link
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
  .pick {
    flex: none;
    max-width: 50%;
  }
  .card-head .name {
    flex: none;
    margin-inline-end: auto;
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
  .share {
    flex: none;
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    cursor: default;
  }
  @media (hover: hover) {
    .share:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
  }
  .share:active:not(:disabled) {
    background: var(--press);
  }
  .reach {
    display: flex;
    padding: var(--space-1) 0 var(--space-2);
  }
  .under {
    flex: none;
    width: var(--row-height-sm);
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
