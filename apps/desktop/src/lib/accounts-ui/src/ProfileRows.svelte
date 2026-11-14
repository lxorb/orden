<script lang="ts">
  import { dropOver } from '../../drag-paths'
  import { account } from '../../accounts/src/api'
  import { chooseFiles, PICTURES } from '../../choose-files'
  import { type Box, Glyph } from '../../chat-kit/src/api'
  import { Cross } from '../../ui-kit/src/api'
  import { message } from '../../ui-kit/src/api'
  import { menu } from '../../menu.svelte'
  import { portal } from '../../ui-kit/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { viewport } from '../../ui-kit/src/api'
  import Avatar from './Avatar.svelte'
  import AvatarSheet from './AvatarSheet.svelte'
  import type { Status } from '../../accounts/src/api'
  import { changeProfile, removeFace } from '../../accounts/src/api'
  import { CLEARS, type Clears, clearsAt, stands } from '../../accounts/src/api'
  import { Hint } from '../../ui-controls/src/api'
  import { Switch } from '../../ui-controls/src/api'

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
  <h3>Profile</h3>
  <div class="card">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="orden-setting setting"
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
        size={32}
      />
      <span class="name"
        ><span class="orden-named"
          >Picture<Hint text="The picture the others see beside your name." /></span
        ></span
      >
      <span class="ends">
        <button class="orden-chip" aria-haspopup={camera ? 'menu' : undefined} onclick={change}
          >Change</button
        >
        {#if user.avatar}
          <button class="orden-chip" onclick={() => void kept(removeFace)}>Remove</button>
        {/if}
      </span>
    </div>

    <label class="orden-setting setting">
      <span class="name"
        ><span class="orden-named"
          >Pronouns<Hint text="Shown to the others beside your name, such as she/her." /></span
        ></span
      >
      <input
        class="orden-field is-value"
        value={user.pronouns ?? ''}
        placeholder="Optional"
        maxlength="40"
        spellcheck="false"
        onchange={(event) =>
          void kept(() => changeProfile({ pronouns: event.currentTarget.value }))}
      />
    </label>

    <label class="orden-setting setting is-tall">
      <span class="name"
        ><span class="orden-named"
          >Bio<Hint text="A few words about you that the others see on your profile." /></span
        ></span
      >
      <textarea
        class="orden-field is-value"
        rows="3"
        maxlength="190"
        placeholder="A few words about you"
        value={user.bio ?? ''}
        onchange={(event) => void kept(() => changeProfile({ bio: event.currentTarget.value }))}
      ></textarea>
    </label>

    <div class="orden-setting setting is-tall">
      <span class="name"
        ><span class="orden-named"
          >Status<Hint
            text="What you are up to, shown to the others beside your name until it clears."
          /></span
        ></span
      >
      <span class="orden-field is-value">
        <button
          type="button"
          class="orden-glyph"
          aria-label="Emoji"
          title="Emoji"
          onclick={(event) => pickEmoji(event.currentTarget)}
          >{#if status?.emoji}{status.emoji}{:else}<Glyph name="smile" />{/if}</button
        >
        <input
          value={status?.text ?? ''}
          maxlength="100"
          aria-label="Status"
          placeholder="What’s happening?"
          onchange={(event) => withStatus({ text: event.currentTarget.value })}
        />
        {#if [status?.emoji, status?.text].some(Boolean)}
          <button
            type="button"
            class="orden-glyph"
            aria-label="Clear"
            title="Clear"
            onclick={() => withStatus({ emoji: '', text: '' })}><Cross /></button
          >
        {/if}
      </span>
    </div>

    {#if picking}
      {#await Promise.all( [import('../../chat-kit/src/api'), import('../../emoji/src/api')] ) then [float, picker]}
        <div use:portal>
          <float.Float at={picking} label="Emoji" onclose={() => (picking = null)}>
            <picker.EmojiPicker
              onpick={(emoji: string) => {
                picking = null
                withStatus({ emoji })
              }}
            />
          </float.Float>
        </div>
      {/await}
    {/if}

    {#if status}
      <div class="orden-setting setting">
        <span class="name"
          ><span class="orden-named"
            >Clear after<Hint text="When your status is taken away again." /></span
          ></span
        >
        <div class="orden-setting-value">
          <Select
            value={clears}
            options={CLEARS.map((one) => ({ value: one, label: CLEAR_WORDS[one] }))}
            label="Clear after"
            plain={viewport.touch}
            onchange={(value: string) => {
              clears = value as Clears
              withStatus({})
            }}
          />
        </div>
      </div>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="orden-setting setting pressable"
      onclick={() => withStatus({ quiet: !(status?.quiet ?? false) })}
    >
      <span class="name"
        ><span class="orden-named"
          >Do not disturb<Hint
            text="Silences chat notifications and shows the others you are busy."
          /></span
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
      <span class="name"
        ><span class="orden-named"
          >Appear offline<Hint
            text="The others see you as offline even while you are here."
          /></span
        ></span
      >
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
{/if}

<style>
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
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
