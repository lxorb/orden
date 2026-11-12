<script lang="ts">
  import { account } from '../account.svelte'
  import { chatsUnread } from '../ai/unread.svelte'
  import UnreadDot from '../ai/UnreadDot.svelte'
  import { CHATS_MARK, SEARCH_MARK, TASKS_MARK } from '../panel-marks'
  import { chatsOn, hiddenKinds } from '../settings.svelte'
  import { viewport } from '../viewport.svelte'
  import { workspace } from '../workspace.svelte'
  import { writeNew } from '../write-new'
  import { PHONE_TABS, type PhoneTab } from '../workspace/panels'

  const NOTES_MARK =
    'M3.5 1.5h4l3 3v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM7.5 1.5v3h3M4.5 7.5h4M4.5 9.5h2.5'

  const PLUS_MARK = 'M12 5v14M5 12h14'

  const LOOKS: Record<PhoneTab, { label: () => string; mark: string }> = {
    tree: { label: () => 'Notes', mark: NOTES_MARK },
    tasks: { label: () => 'Tasks', mark: TASKS_MARK },
    chats: { label: () => 'Chats', mark: CHATS_MARK },
    search: { label: () => 'Search', mark: SEARCH_MARK },
  }

  const tabs = $derived(
    PHONE_TABS.filter(
      (one) =>
        workspace.offers(one) &&
        workspace.fills(one) &&
        (one !== 'chats' || (!__EVEN_PLUGIN__ && !!account.accountToken && chatsOn())) &&
        (one !== 'tasks' || !__EVEN_PLUGIN__),
    ),
  )

  const on = $derived(workspace.panel ?? workspace.reopens)

  function go(tab: PhoneTab) {
    if (on === tab && workspace.panel === tab) {
      document
        .querySelector<HTMLElement>(`[data-panel="${tab}"]`)
        ?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    workspace.showPanel(tab)
  }
</script>

{#if !viewport.typing}
  <div class="phone">
    {#if on === 'tree' && hiddenKinds.offers('note')}
      <button class="new" aria-label="New note" onclick={writeNew}>
        <svg viewBox="0 0 24 24"><path d={PLUS_MARK} /></svg>
      </button>
    {/if}
    <nav class="bar" data-phone-tabs aria-label="Panels">
      {#each tabs as tab (tab)}
        <button
          class="tab"
          class:on={on === tab}
          data-tab={tab}
          aria-current={on === tab ? 'page' : undefined}
          onclick={() => go(tab)}
        >
          <span class="mark">
            <svg viewBox="0 0 13 13"><path d={LOOKS[tab].mark} /></svg>
            {#if tab === 'chats' && chatsUnread.any}
              <UnreadDot corner />
            {/if}
          </span>
          <span class="label">{LOOKS[tab].label()}</span>
        </button>
      {/each}
    </nav>
  </div>
{/if}

<style>
  .phone {
    position: relative;
    flex: none;
  }

  .bar {
    display: flex;
    justify-content: space-around;
    padding: 0 max(var(--space-2), var(--inset-right))
      max(var(--space-1), calc(var(--inset-bottom) - var(--keyboard, 0px)))
      max(var(--space-2), var(--inset-left));
    background: var(--bg);
    box-shadow: inset 0 1px var(--line);
  }

  .tab {
    flex: 1;
    min-width: 0;
    min-height: var(--touch-row);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: var(--space-1) 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    -webkit-tap-highlight-color: transparent;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .tab.on {
    color: var(--accent);
  }

  .mark {
    position: relative;
    display: grid;
    place-items: center;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .tab:active .mark {
    transform: scale(0.88);
  }

  .mark svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tab.on .mark svg {
    stroke-width: 1.35;
  }

  .label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-strong);
  }

  .new {
    position: absolute;
    inset-inline-end: max(var(--space-4), var(--inset-right));
    bottom: calc(100% + var(--space-4));
    z-index: var(--z-float);
    width: var(--touch-row);
    height: var(--touch-row);
    display: grid;
    place-items: center;
    border: none;
    border-radius: calc(var(--touch-row) * var(--radius-third));
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: var(--shadow-lg);
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur-fast) var(--ease-spring);
  }

  .new:active {
    transform: scale(0.92);
  }

  .new svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>
