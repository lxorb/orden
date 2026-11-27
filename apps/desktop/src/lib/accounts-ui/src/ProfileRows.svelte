<script lang="ts">
  import { dropOver, message, portal, viewport, menu } from '../../ui-kit/src/api'
  import { account } from '../../accounts/src/api'
  import { chooseFiles, PICTURES } from '../../ui-controls/src/api'
  import { type Box, Glyph } from '../../chat-kit/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { Avatar } from '../../faces/src/api'
  import AvatarSheet from './AvatarSheet.svelte'
  import type { Status } from '../../accounts/src/api'
  import { changeProfile, removeFace } from '../../accounts/src/api'
  import { CLEARS, type Clears, clearsAt, stands } from '../../accounts/src/api'
  import { EditRow, EditSheet, Hint } from '../../ui-controls/src/api'
  import { Switch } from '../../ui-controls/src/api'
  import type { Snippet } from 'svelte'

  const { children }: { children?: Snippet } = $props()

  const user = $derived(account.user)
  const status = $derived(user && stands(user.status, Date.now()) ? (user.status ?? null) : null)
  let source = $state<{ file: Blob } | { camera: true } | null>(null)
  let clears = $state<Clears>('today')
  let wrong = $state<string | null>(null)
  let picking = $state<Box | null>(null)
  const camera = typeof navigator !== 'undefined' && (viewport.touch || !!navigator.mediaDevices)
  const CLEAR_WORDS: Record<Clears, string> = {
    '30m': '30 minutes',
    '1h': '1 hour',
    '4h': '4 hours',
    today: 'Today',
    week: 'This week',
    never: 'Never',
  }
  async function kept(work: () => Promise<void>) {
    wrong = null
    try {
      await work()
    } catch (error) {
      wrong = message(error, 'that did not work')
    }
  }
  function withStatus(changes: Partial<Omit<Status, 'until'>>) {
    const next = {
      emoji: status?.emoji ?? '',
      text: status?.text ?? '',
      quiet: status?.quiet ?? false,
      ...changes,
    }
    const empty = !next.emoji.trim() && !next.text.trim() && !next.quiet
    void kept(() =>
      changeProfile({
        status: empty ? null : { ...next, until: clearsAt(clears, new Date()) },
      }),
    )
  }
  async function choose(fromCamera = false) {
    const [file] = await chooseFiles({ accept: PICTURES, camera: fromCamera })
    if (file) source = { file }
  }
  function takePhoto() {
    if (viewport.touch) void choose(true)
    else source = { camera: true }
  }
  function change(event: MouseEvent) {
    if (!camera) return void choose()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    menu.show(
      new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom }),
      [
        { label: 'Choose a picture', asks: true, run: () => void choose() },
        { label: 'Take photo', asks: true, run: takePhoto },
      ],
      { title: 'Picture' },
    )
  }
  let editing = $state<'bio' | 'status' | null>(null)
  const draft = $state({ bio: '', emoji: '', text: '' })
  function open(which: 'bio' | 'status') {
    draft.bio = user?.bio ?? ''
    draft.emoji = status?.emoji ?? ''
    draft.text = status?.text ?? ''
    editing = which
  }
  function pickEmoji(from: HTMLElement) {
    const box = from.getBoundingClientRect()
    picking = { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }
  function given(files: FileList | null | undefined) {
    const file = [...(files ?? [])].find((one) => one.type.startsWith('image/'))
    if (file) source = { file }
  }
</script>

{#if user}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="profile"
    use:dropOver={(event) => event.preventDefault()}
    ondrop={(event) => {
      event.preventDefault()
      given(event.dataTransfer?.files)
    }}
    onpaste={(event) => given(event.clipboardData?.files)}
  >
    <Avatar
      face={{
        name: account.name ?? '',
        avatar: user.avatar ?? null,
        key: user.id,
      }}
      size={80}
    />
    <span class="who">
      <b>{account.name ?? ''}</b>
      {#if user.email}<small>{user.email}</small>{/if}
    </span>
    <span class="ends">
      <button class="orden-chip" aria-haspopup={camera ? 'menu' : undefined} onclick={change}>Change picture</button>
      {#if user.avatar}
        <button class="orden-chip is-danger" onclick={() => void kept(removeFace)}>Remove</button>
      {/if}
    </span>
  </div>

  {@render children?.()}

  <div class="card">
    <EditRow
      label="Bio"
      value={user.bio?.trim() ? user.bio : null}
      empty="None"
      hint="A few words about you that the others see on your profile."
      onedit={() => open('bio')}
    />
    <EditRow
      label="Status"
      value={status && (status.emoji || status.text) ? [status.emoji, status.text].filter(Boolean).join(' ') : null}
      empty="None"
      hint="What you are up to, shown to the others beside your name until it clears."
      onedit={() => open('status')}
    />

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-setting setting pressable" onclick={() => withStatus({ quiet: !(status?.quiet ?? false) })}>
      <span class="name"
        ><span class="orden-named"
          >Do not disturb<Hint text="Silences chat notifications and shows the others you are busy." /></span
        ></span
      >
      <Switch
        on={status?.quiet ?? false}
        label="Do not disturb"
        onchange={(on: boolean) => withStatus({ quiet: on })}
      />
    </div>

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="orden-setting setting pressable"
      onclick={() => void kept(() => changeProfile({ hidden: !(user.hidden ?? false) }))}
    >
      <span class="name"><span class="orden-named">Appear offline</span></span>
      <Switch
        on={user.hidden ?? false}
        label="Appear offline"
        onchange={(on: boolean) => void kept(() => changeProfile({ hidden: on }))}
      />
    </div>
  </div>
  {#if wrong}<p class="wrong">{wrong}</p>{/if}

  {#if source}
    <AvatarSheet {source} onclose={() => (source = null)} />
  {/if}

  <EditSheet
    open={editing === 'bio'}
    title="Bio"
    ready={draft.bio !== (user.bio ?? '')}
    onsave={() => {
      editing = null
      void kept(() => changeProfile({ bio: draft.bio.trim() }))
    }}
    onclose={() => (editing = null)}
  >
    <label
      >Bio<textarea
        class="orden-field"
        rows="4"
        maxlength="190"
        placeholder="A few words about you"
        bind:value={draft.bio}
        data-lands></textarea></label
    >
  </EditSheet>

  <EditSheet
    open={editing === 'status'}
    title="Status"
    onsave={() => {
      editing = null
      withStatus({ emoji: draft.emoji, text: draft.text.trim() })
    }}
    onclose={() => (editing = null)}
  >
    <div class="said">
      <button
        type="button"
        class="orden-glyph"
        aria-label="Emoji"
        title="Emoji"
        onclick={(event) => pickEmoji(event.currentTarget)}
        >{#if draft.emoji}{draft.emoji}{:else}<Glyph name="smile" />{/if}</button
      >
      <input
        class="orden-field"
        bind:value={draft.text}
        maxlength="100"
        aria-label="Status"
        placeholder="What’s happening?"
        data-lands
      />
    </div>
    <label
      >Clear after<Select
        value={clears}
        options={CLEARS.map((one) => ({ value: one, label: CLEAR_WORDS[one] }))}
        label="Clear after"
        onchange={(value: string) => (clears = value as Clears)}
      /></label
    >
    {#if status && (status.emoji || status.text)}
      <button
        type="button"
        class="orden-chip is-quiet clear"
        onclick={() => {
          editing = null
          withStatus({ emoji: '', text: '' })
        }}>Clear status</button
      >
    {/if}
  </EditSheet>

  {#if picking}
    {#await Promise.all([import('../../chat-kit/src/api'), import('../../emoji/src/api')]) then [float, picker]}
      <div use:portal>
        <float.Float at={picking} label="Emoji" onclose={() => (picking = null)}>
          <picker.EmojiPicker
            onpick={(emoji: string) => {
              picking = null
              draft.emoji = emoji
            }}
          />
        </float.Float>
      </div>
    {/await}
  {/if}
{/if}

<style>
  .profile {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .who b {
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: 20px;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who small {
    overflow: hidden;
    font-size: var(--text-sm);
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .setting .name {
    flex: 1;
  }
  .ends {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }
  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }
  :global(.sheet.phone) .setting + .setting::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: var(--touch-pad);
    inset-inline-end: 0;
    height: 1px;
    background: var(--line);
  }
  .said {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .said input {
    flex: 1;
  }
  .clear {
    align-self: flex-start;
  }
  .pressable {
    cursor: default;
  }
  .wrong {
    margin: var(--space-2) 0 0;
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
</style>
