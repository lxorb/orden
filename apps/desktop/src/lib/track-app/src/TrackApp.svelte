<script lang="ts">
  import { providePort } from '@orden/contracts'
  import { account } from '../../accounts/src/api'
  import { loadSignIn } from '../../sign-in/src/api'
  import { closeOnBack, longPress } from '../../ui-kit/src/api'
  import { undoToast } from '../../undo-toast/src/api'
  import { type Screen, TrackNav, type TrackParts, WIDE } from './nav.svelte'
  import Settings from './Settings.svelte'
  import Undo from './Undo.svelte'

  const { screens, nav = new TrackNav() }: { screens: TrackParts; nav?: TrackNav } = $props()
  const { Activities, BottomSheet, Day, Now, Stats } = $derived(screens)
  const SCREENS: readonly { id: Screen; label: string; mark: string }[] = [
    { id: 'now', label: 'Now', mark: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM10 8.6v6.8l5.4-3.4z' },
    { id: 'day', label: 'Day', mark: 'M4.5 6.5h2M9.5 6.5h10M4.5 12h2M9.5 12h10M4.5 17.5h2M9.5 17.5h10' },
    { id: 'stats', label: 'Stats', mark: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12zM14.5 3.9a8.5 8.5 0 0 1 5.6 5.6h-5.6z' },
  ]
  let wide = $state(0)
  let tipped = $state<string | null>(null)
  let untip: ReturnType<typeof setTimeout> | undefined
  function tip(label: string) {
    clearTimeout(untip)
    tipped = label
    untip = setTimeout(() => (tipped = null), 1500)
  }
  const beside = $derived(wide >= WIDE)
  const signed = $derived(account.token !== null && account.guest === null)
  const ticker = $derived(screens.ticking())
  const now = $derived(ticker.now)
  const left = $derived<Screen>(beside && nav.screen === 'day' ? 'now' : nav.screen)
  $effect(() => providePort('time.open', { show: (spec) => nav.open(screens.readSpec(spec)) }))
  $effect(() => {
    const deep = !nav.settings && !nav.activities && (nav.only !== null || nav.screen !== 'now')
    return closeOnBack(!asking && deep, () => void nav.back())
  })
  const GREETED = 2500
  let asking = $state(account.token === null || account.guest !== null)
  $effect(() => {
    if (!signed) asking = true
  })
  $effect(() => {
    if (!signed || !asking) return
    const timer = setTimeout(() => (asking = false), GREETED)
    return () => clearTimeout(timer)
  })
  $effect(() => {
    if (signed && account.settling) account.settled()
  })
  function undo() {
    const own = undoToast.own
    undoToast.dismiss()
    void own?.undo()
  }
</script>

<svelte:window bind:innerWidth={wide} />

{#if asking}
  {#await loadSignIn() then { default: SignIn }}
    <SignIn name="Orden Track" alone={false} onsignedin={() => (asking = false)} />
  {/await}
{:else}
  <div class="track" class:beside data-track={nav.screen}>
    <div class="panes">
      {#if left !== 'day'}
        <main class="pane" data-track-pane={left}>
          {#if left === 'now'}
            <Now {now} onday={(at) => nav.showDay(at ?? now)} />
          {:else}
            <Stats
              {now}
              range={nav.range}
              onrange={(range) => (nav.range = range)}
              onpick={(activity, day) => nav.showDay(day, activity)}
            />
          {/if}
        </main>
      {/if}
      {#if beside || nav.screen === 'day'}
        <main class="pane" data-track-pane="day">
          <Day
            {now}
            day={nav.day}
            only={nav.only}
            onday={(day) => (nav.day = day)}
            onall={() => (nav.only = null)}
            onmanage={() => (nav.activities = true)}
          />
        </main>
      {/if}
    </div>
    <nav class="bar" aria-label="Screens" data-track-tabs>
      {#each SCREENS as one (one.id)}
        {#if !beside || one.id !== 'day'}
          <button
            type="button"
            class="tab"
            class:on={left === one.id}
            aria-label={one.label}
            aria-current={left === one.id ? 'page' : undefined}
            data-tab={one.id}
            use:longPress={() => tip(one.label)}
            onclick={() => nav.show(one.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={one.mark} /></svg>
          </button>
        {/if}
      {/each}
      <button
        type="button"
        class="tab"
        aria-label="Settings"
        aria-haspopup="dialog"
        data-tab="settings"
        use:longPress={() => tip('Settings')}
        onclick={() => (nav.settings = true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h7M16 17h3M16 5v4M9 10v4M14 15v4" /></svg
        >
      </button>
    </nav>
    {#if tipped}<span class="tip" role="tooltip" data-track-tip>{tipped}</span>{/if}
    <Undo onundo={undo} />
  </div>
  <BottomSheet open={nav.settings} label="Settings" onclose={() => (nav.settings = false)}>
    <Settings
      reminders={screens.reminders}
      onactivities={() => (nav.activities = true)}
      onclose={() => (nav.settings = false)}
    />
  </BottomSheet>
  <Activities open={nav.activities} onclose={() => (nav.activities = false)} />
{/if}

<style>
  .track {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    -webkit-font-smoothing: antialiased;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
    padding-inline: var(--inset-left, 0px) var(--inset-right, 0px);
  }
  .pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: calc(var(--inset-top, 0px) + var(--space-4)) var(--space-4) var(--space-4);
  }
  .beside .pane + .pane {
    box-shadow: inset 1px 0 var(--line);
  }
  .bar {
    flex: none;
    display: flex;
    justify-content: space-around;
    padding: var(--space-1) max(var(--space-4), var(--inset-left, 0px)) max(var(--space-2), var(--inset-bottom, 0px));
    background: var(--bg);
    box-shadow: inset 0 1px var(--line);
  }
  .tab {
    flex: 1;
    min-width: var(--touch-target);
    min-height: 52px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--muted);
    -webkit-tap-highlight-color: transparent;
  }
  .tab svg {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .tab:active svg {
    transform: scale(0.88);
  }
  .tip {
    position: fixed;
    left: 50%;
    bottom: calc(var(--inset-bottom, 0px) + 72px);
    translate: -50% 0;
    padding: var(--space-1) var(--space-3);
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    font-size: var(--text-sm);
    font-weight: 600;
    pointer-events: none;
  }
  .tab.on {
    color: var(--accent);
  }
</style>
