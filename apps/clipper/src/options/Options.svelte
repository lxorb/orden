<script lang="ts">
  import { firstOf, refreshSpaces } from '../lib/account'
  import { api, type Space } from '../lib/api'
  import { openShortcuts } from '../lib/browser'
  import { i18n, LANGUAGES, t } from '../lib/i18n.svelte'
  import { opened } from '../lib/opened'
  import SignIn from '../lib/SignIn.svelte'
  import { forget, remember, type Theme } from '../lib/settings'
  import { applyTheme, followSystem } from '../lib/theme'

  const held = opened()

  const THEMES: { id: Theme; name: string }[] = [
    { id: 'system', name: 'Match the system' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
  ]

  let token = $state(held.token)
  let email = $state(held.email)
  let spaces = $state<Space[]>(held.spaces)
  let spaceId = $state(firstOf(held.spaces, held.target.spaceId))
  let folder = $state(held.target.folder)
  let theme = $state(held.theme)

  $effect(() => {
    if (!token) return

    void refreshSpaces(token)
      .then((listed) => {
        spaces = listed
        spaceId = firstOf(listed, spaceId)
      })
      .catch(() => {
        // The remembered list stays on screen; there is nothing here to say
        // that the picker does not already show.
      })
  })

  // The choice can be the system's, and the system can change while this page
  // is open on it.
  $effect(() => followSystem(() => theme))

  function chooseTheme(next: Theme) {
    theme = next
    applyTheme(next)
    void remember({ theme: next })
  }

  function chooseLanguage(next: string) {
    i18n.use(next)
    void remember({ language: next })
  }

  function chooseTarget() {
    void remember({ target: { spaceId, folder } })
  }

  async function signOut() {
    const going = token
    await forget()

    token = null
    email = null
    spaces = []

    // The session is gone from this browser either way; telling the service is
    // a courtesy that a network failure must not undo.
    if (going) await api.signOut(going).catch(() => undefined)
  }
</script>

<main>
  {#if token}
    <section>
      <div class="setting">
        <span class="name">{t('Account')}</span>
        <span class="value">{email}</span>
      </div>

      <div class="setting">
        <span class="name">{t('Space')}</span>
        <select
          bind:value={spaceId}
          onchange={chooseTarget}
          aria-label={t('Space')}
          disabled={!spaces.length}
        >
          {#each spaces as space (space.id)}
            <option value={space.id}>{space.name}</option>
          {/each}
        </select>
      </div>

      <label class="setting">
        <span class="name">{t('Folder')}</span>
        <input bind:value={folder} oninput={chooseTarget} spellcheck="false" placeholder="/" />
      </label>
    </section>

    <section>
      <div class="setting">
        <span class="name">{t('Language')}</span>
        <select
          value={i18n.choice}
          onchange={(event) => chooseLanguage(event.currentTarget.value)}
          aria-label={t('Language')}
        >
          {#each LANGUAGES as language (language.id)}
            <option value={language.id}>{t(language.name)}</option>
          {/each}
        </select>
      </div>

      <div class="setting">
        <span class="name">{t('Appearance')}</span>
        <select
          value={theme}
          onchange={(event) => chooseTheme(event.currentTarget.value as Theme)}
          aria-label={t('Appearance')}
        >
          {#each THEMES as one (one.id)}
            <option value={one.id}>{t(one.name)}</option>
          {/each}
        </select>
      </div>

      <div class="setting">
        <span class="name">{t('Shortcuts')}</span>
        <button class="quiet" type="button" onclick={openShortcuts}>{t('Open')}</button>
      </div>
    </section>

    <button class="out" type="button" onclick={() => void signOut()}>{t('Sign out')}</button>
  {:else}
    <SignIn
      onSignedIn={() => {
        const fresh = opened()
        token = fresh.token
        email = fresh.email
        spaces = fresh.spaces
      }}
    />
  {/if}
</main>

<style>
  main {
    width: min(30rem, calc(100vw - var(--space-6)));
    margin: var(--space-7) auto;
    padding: var(--space-2) var(--space-5) var(--space-5);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
  }

  section + section {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }

  /* The same row the app's settings use: the name on the left, the one control
     that changes it on the right. */
  .setting {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 46px;
    font-size: var(--text-sm);
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .value {
    color: var(--muted-strong);
  }

  .setting select,
  .setting input {
    flex: none;
    width: 14rem;
    padding: 7px 11px;
    font-size: var(--text-sm);
  }

  .setting select {
    padding-right: 30px;
  }

  .quiet {
    padding: 6px 12px;
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .quiet:hover:not(:disabled) {
    background: var(--surface-3);
  }

  .quiet:active:not(:disabled) {
    background: var(--press);
  }

  .out {
    width: 100%;
    margin-top: var(--space-4);
    background: none;
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  .out:hover:not(:disabled) {
    background: none;
    color: var(--danger);
    transform: none;
  }
</style>
