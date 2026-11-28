<script lang="ts">
  import { account } from '../../accounts/src/api'
  import { theme } from '../../theme/src/api'

  const {
    reminders,
    onrefresh,
    onactivities,
    onclose,
  }: {
    reminders: { readonly on: boolean; set(on: boolean): void }
    onrefresh: () => Promise<void>
    onactivities: () => void
    onclose: () => void
  } = $props()
  const SCHEMES = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ] as const
  let syncing = $state(false)
  function sync() {
    syncing = true
    void onrefresh()
      .catch(() => undefined)
      .then(() => (syncing = false))
  }
  function leave() {
    onclose()
    void account.leave()
  }
</script>

<div class="settings" data-track-settings>
  <h2>Settings</h2>
  <button type="button" class="orden-row" data-track-activities onclick={onactivities}>Activities and goals</button>
  <button
    type="button"
    role="switch"
    class="orden-row line"
    aria-checked={reminders.on}
    data-track-reminders
    onclick={() => reminders.set(!reminders.on)}
  >
    <span>Reminders</span>
    <span class="knob" class:on={reminders.on} aria-hidden="true"></span>
  </button>
  <div class="schemes" role="radiogroup" aria-label="Appearance">
    {#each SCHEMES as one (one.id)}
      <button
        type="button"
        role="radio"
        class="scheme"
        class:on={theme.scheme === one.id}
        aria-checked={theme.scheme === one.id}
        data-track-scheme={one.id}
        onclick={() => theme.setScheme(one.id)}>{one.label}</button
      >
    {/each}
  </div>
  <button type="button" class="orden-row" disabled={syncing} data-track-sync onclick={sync}
    >{syncing ? 'Syncing' : 'Sync now'}</button
  >
  <p class="who">{account.user?.email ?? ''}</p>
  <button type="button" class="orden-row is-danger" data-track-leave onclick={leave}>Log out</button>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: 1.125rem;
    font-weight: 650;
  }
  .settings :global(button),
  .line {
    min-height: var(--touch-target);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .knob {
    position: relative;
    flex: none;
    width: 44px;
    height: 26px;
    border-radius: 13px;
    background: var(--line-strong);
    transition: background var(--dur-fast) var(--ease-out);
  }
  .knob::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--bg);
    transition: translate var(--dur-fast) var(--ease-out);
  }
  .knob.on {
    background: var(--accent);
  }
  .knob.on::after {
    translate: 18px 0;
  }
  .schemes {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--bg);
  }
  .scheme {
    flex: 1;
    border: none;
    border-radius: 10px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-weight: 600;
  }
  .scheme.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .who {
    margin: var(--space-3) 0 0;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
</style>
