<script lang="ts">
  /** What the others see of the account, in Settings > Account under its name: the
   *  face, pronouns, a few words, a status that clears itself, Do not disturb, the
   *  accent the initial sits on, and Appear offline. Each row is kept as it is changed,
   *  the way every setting is; there is nothing to confirm.
   *
   *  A picture comes from a press on Change, a file dropped or pasted on the row, or the
   *  camera, and goes through the avatar sheet, which is the one way a face is made.
   *  Fetched with the Account pane, so nobody who never opens it downloads any of it.
   *  See docs/chats.md 4.9. */
  import { account } from '../account.svelte'
  import { ACCENTS, accentColour } from '../accents'
  import { chooseFiles, PICTURES } from '../choose-files'
  import Glyph from '../chats/view/Glyph.svelte'
  import type { Box } from '../chats/view/place'
  import Cross from '../Cross.svelte'
  import { key, message, t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { portal } from '../portal'
  import Select from '../Select.svelte'
  import Swatches from '../Swatches.svelte'
  import { theme } from '../theme.svelte'
  import { viewport } from '../viewport.svelte'
  import Avatar from './Avatar.svelte'
  import AvatarSheet from './AvatarSheet.svelte'
  import type { Status } from './face'
  import { changeProfile, removeFace } from './mine'
  import { CLEARS, type Clears, clearsAt, stands } from './status'
  import Hint from '../Hint.svelte'

  const user = $derived(account.user)
  const status = $derived(user && stands(user.status, Date.now()) ? (user.status ?? null) : null)

  let source = $state<{ file: Blob } | { camera: true } | null>(null)
  let clears = $state<Clears>('today')
  let wrong = $state<string | null>(null)
  /** Where the emoji picker hangs from while it is up. */
  let picking = $state<Box | null>(null)

  /** Whether there is a camera to offer: a computer's webcam, shown in the sheet through
   *  the browser's own question, or a phone's own camera app, through the picker. */
  const camera = typeof navigator !== 'undefined' && (viewport.touch || !!navigator.mediaDevices)

  const CLEAR_WORDS: Record<Clears, string> = {
    '30m': key('30 minutes'),
    '1h': key('1 hour'),
    '4h': key('4 hours'),
    today: key('Today'),
    week: key('This week'),
    never: key('Never'),
  }

  const accents = $derived(
    ACCENTS.map((one) => ({
      value: one.id,
      label: t(one.name),
      colour: accentColour(one.id, theme.current),
    })),
  )

  async function kept(work: () => Promise<void>) {
    wrong = null
    try {
      await work()
    } catch (error) {
      wrong = message(error, 'that did not work')
    }
  }

  /** The status as it would stand with these changes, ending when `clears` says. */
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

  /** A phone takes the picture with its own camera app, which is what somebody holding
   *  one expects; a computer shows its camera in the sheet. */
  function takePhoto() {
    if (viewport.touch) void choose(true)
    else source = { camera: true }
  }

  /** One press for a new picture, as there is one for taking it away: a file, or
   *  where there is a camera, a menu of the two ways a face comes in. */
  function change(event: MouseEvent) {
    if (!camera) return void choose()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    menu.show(
      new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom }),
      [
        { label: t('Choose a picture'), asks: true, run: () => void choose() },
        { label: t('Take photo'), asks: true, run: takePhoto },
      ],
      { title: t('Picture') },
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
  <h3>{t('Profile')}</h3>
  <div class="card">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="nib-setting setting"
      ondragover={(event) => event.preventDefault()}
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
          accent: user.accent ?? null,
          key: user.id,
        }}
        size={32}
      />
      <span class="name"
        ><span class="nib-named"
          >{t('Picture')}<Hint text={t('The picture the others see beside your name.')} /></span
        ></span
      >
      <span class="ends">
        <button class="nib-chip" aria-haspopup={camera ? 'menu' : undefined} onclick={change}
          >{t('Change')}</button
        >
        {#if user.avatar}
          <button class="nib-chip" onclick={() => void kept(removeFace)}>{t('Remove')}</button>
        {/if}
      </span>
    </div>

    <label class="nib-setting setting">
      <span class="name"
        ><span class="nib-named"
          >{t('Pronouns')}<Hint
            text={t('Shown to the others beside your name, such as she/her.')}
          /></span
        ></span
      >
      <input
        class="nib-field is-value"
        value={user.pronouns ?? ''}
        placeholder={t('Optional')}
        maxlength="40"
        spellcheck="false"
        onchange={(event) =>
          void kept(() => changeProfile({ pronouns: event.currentTarget.value }))}
      />
    </label>

    <label class="nib-setting setting is-tall">
      <span class="name"
        ><span class="nib-named"
          >{t('Bio')}<Hint
            text={t('A few words about you that the others see on your profile.')}
          /></span
        ></span
      >
      <textarea
        class="nib-field is-value"
        rows="3"
        maxlength="190"
        placeholder={t('A few words about you')}
        value={user.bio ?? ''}
        onchange={(event) => void kept(() => changeProfile({ bio: event.currentTarget.value }))}
      ></textarea>
    </label>

    <div class="nib-setting setting is-tall">
      <span class="name"
        ><span class="nib-named"
          >{t('Status')}<Hint
            text={t('What you are up to, shown to the others beside your name until it clears.')}
          /></span
        ></span
      >
      <!-- One field: the emoji is pressed in front of the words, as a chat's composer
           has it, and the cross at the end takes the whole status away. -->
      <span class="nib-field is-value">
        <button
          type="button"
          class="nib-glyph"
          aria-label={t('Emoji')}
          title={t('Emoji')}
          onclick={(event) => pickEmoji(event.currentTarget)}
          >{#if status?.emoji}{status.emoji}{:else}<Glyph name="smile" />{/if}</button
        >
        <input
          value={status?.text ?? ''}
          maxlength="100"
          aria-label={t('Status')}
          placeholder={t('What’s happening?')}
          onchange={(event) => withStatus({ text: event.currentTarget.value })}
        />
        {#if [status?.emoji, status?.text].some(Boolean)}
          <button
            type="button"
            class="nib-glyph"
            aria-label={t('Clear')}
            title={t('Clear')}
            onclick={() => withStatus({ emoji: '', text: '' })}><Cross /></button
          >
        {/if}
      </span>
    </div>

    {#if picking}
      {#await Promise.all( [import('../chats/view/Float.svelte'), import('../emoji/EmojiPicker.svelte')] ) then [float, picker]}
        <div use:portal>
          <float.default at={picking} label={t('Emoji')} onclose={() => (picking = null)}>
            <picker.default
              onpick={(emoji: string) => {
                picking = null
                withStatus({ emoji })
              }}
            />
          </float.default>
        </div>
      {/await}
    {/if}

    <!-- When the status goes again, which is only a question while there is one. -->
    {#if status}
      <div class="nib-setting setting">
        <span class="name"
          ><span class="nib-named"
            >{t('Clear after')}<Hint text={t('When your status is taken away again.')} /></span
          ></span
        >
        <div class="nib-setting-value">
          <Select
            value={clears}
            options={CLEARS.map((one) => ({ value: one, label: t(CLEAR_WORDS[one]) }))}
            label={t('Clear after')}
            plain={viewport.touch}
            onchange={(value: string) => {
              clears = value as Clears
              withStatus({})
            }}
          />
        </div>
      </div>
    {/if}

    <div
      class="nib-setting setting pressable"
      role="switch"
      tabindex="0"
      aria-checked={status?.quiet ?? false}
      onclick={() => withStatus({ quiet: !(status?.quiet ?? false) })}
      onkeydown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        withStatus({ quiet: !(status?.quiet ?? false) })
      }}
    >
      <span class="name"
        ><span class="nib-named"
          >{t('Do not disturb')}<Hint
            text={t('Silences chat notifications and shows the others you are busy.')}
          /></span
        ></span
      >
      <span class="nib-switch" class:on={status?.quiet ?? false} aria-hidden="true"></span>
    </div>

    <div class="nib-setting setting">
      <span class="name"
        ><span class="nib-named"
          >{t('Accent')}<Hint text={t('The colour the others see beside your name.')} /></span
        ></span
      >
      <div class="nib-setting-value is-wrapping">
        <Swatches
          options={accents}
          label={t('Accent')}
          chosen={user.accent ?? ''}
          onchoose={(value: string) => void kept(() => changeProfile({ accent: value }))}
        />
      </div>
    </div>

    <div
      class="nib-setting setting pressable"
      role="switch"
      tabindex="0"
      aria-checked={user.hidden ?? false}
      onclick={() => void kept(() => changeProfile({ hidden: !(user.hidden ?? false) }))}
      onkeydown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        void kept(() => changeProfile({ hidden: !(user.hidden ?? false) }))
      }}
    >
      <span class="name"
        ><span class="nib-named"
          >{t('Appear offline')}<Hint
            text={t('The others see you as offline even while you are here.')}
          /></span
        ></span
      >
      <span class="nib-switch" class:on={user.hidden ?? false} aria-hidden="true"></span>
    </div>
  </div>
  {#if wrong}<p class="wrong">{wrong}</p>{/if}

  {#if source}
    <AvatarSheet {source} onclose={() => (source = null)} />
  {/if}
{/if}

<style>
  /* The settings pane's own shapes, carried here the way Security.svelte carries
     them: the pane's are scoped to it. See SettingsPanel.svelte. */
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

  /* What a row holds at its end, kept together: where there is no room for all of it
     beside the name, it goes under the name as one, at the end. */
  .ends {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* A phone draws the box, the touch rows and the hairlines between them, the way
     Security.svelte does for its own cards: the sheet is the panel's, so that half
     of the selector is global and the rows are this pane's. */
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
