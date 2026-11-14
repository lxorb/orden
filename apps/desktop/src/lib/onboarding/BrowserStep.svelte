<script lang="ts">
  import { onMount } from 'svelte'
  import { closeOnBack } from '../ui-kit/src/api'
  import {
    BROWSERS,
    type Brand,
    CUSTOM_SETTINGS,
    LATER_BROWSERS,
    MAIN_BROWSERS,
    type Preset,
    type PresetSetting,
    SETTING_NAMES,
  } from './catalog'
  import { matching, requestKey, typedName } from './flow'
  import RequestRow from './RequestRow.svelte'
  import Screen from './Screen.svelte'
  import SearchField from './SearchField.svelte'
  import { applyPreset, currentSettings, presetOf, setup } from './setup-state.svelte'
  import Tile from './Tile.svelte'

  const UNLISTED = 'unlisted'
  const CUSTOM = 'custom'

  let view = $state<'main' | 'other'>('main')
  let picked = $state<string | null>(null)
  let query = $state('')
  let custom = $state<Record<PresetSetting, boolean>>({
    fitTabs: true,
    iconTabs: true,
    byUse: false,
    swipe: true,
  })

  onMount(() => {
    void currentSettings().then((now) => (custom = now))
  })

  const main = MAIN_BROWSERS.map((id) => BROWSERS.find((one) => one.id === id)).filter(
    (one) => one !== undefined,
  )
  const known = $derived(matching(BROWSERS, query))
  const later = $derived(matching(LATER_BROWSERS, query))
  const nothing = $derived(!!query.trim() && !known.length && !later.length)

  const asked = $derived.by((): Brand | null => {
    if (picked === UNLISTED)
      return { id: UNLISTED, name: typedName(query), icon: null, colour: null }
    return LATER_BROWSERS.find((one) => one.id === picked) ?? null
  })

  const preset = $derived<Preset | null>(presetOf(picked))
  const chips = $derived(preset ? (Object.entries(preset) as [PresetSetting, boolean][]) : [])

  function other() {
    view = 'other'
    picked = null
    query = ''
  }

  function leave() {
    view = 'main'
    picked = null
  }

  $effect(() => closeOnBack(view === 'other', leave))

  async function done() {
    if (picked === CUSTOM) await applyPreset(custom)
    else if (preset) await applyPreset(preset)
    setup.answer({ browser: BROWSERS.some((one) => one.id === picked) ? picked : null })
    setup.next()
  }

  function skip() {
    setup.answer({ browser: null })
    setup.next()
  }
</script>

{#snippet globe()}
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"
    ><circle cx="12" cy="12" r="9" /><path
      d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"
    /></svg
  >
{/snippet}

{#snippet sliders()}
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"
    ><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle
      cx="10"
      cy="17"
      r="2"
    /></svg
  >
{/snippet}

<Screen
  title="Which browser do you use now?"
  onback={view === 'other' ? leave : null}
  primary={{ label: 'Continue', disabled: picked === null, onclick: () => void done() }}
  quiet={{ label: 'Skip', onclick: skip }}
>
  {#if view === 'main'}
    <div class="o-grid rise" role="radiogroup" aria-label="Which browser do you use now?">
      {#each main as one (one.id)}
        <Tile
          name={one.name}
          icon={one.icon}
          colour={one.colour}
          checked={picked === one.id}
          onpick={() => (picked = one.id)}
        />
      {/each}
      <Tile name="Other" checked={false} glyph={globe} onpick={other} />
    </div>
  {:else}
    <div class="o-pane pane-in">
      <SearchField
        value={query}
        onvalue={(typed: string) => (query = typed)}
        label="Which browser do you use now?"
      />
      <div class="o-scroll">
        <div class="o-grid" role="radiogroup" aria-label="Which browser do you use now?">
          {#each known as one (one.id)}
            <Tile
              name={one.name}
              icon={one.icon}
              colour={one.colour}
              checked={picked === one.id}
              onpick={() => (picked = one.id)}
            />
          {/each}
          {#each later as one (one.id)}
            <Tile
              name={one.name}
              colour={one.colour}
              later="Not yet"
              checked={picked === one.id}
              onpick={() => (picked = one.id)}
            />
          {/each}
          {#if nothing}
            <Tile
              name={typedName(query)}
              later="Request"
              checked={picked === UNLISTED}
              onpick={() => (picked = UNLISTED)}
            />
          {/if}
          <Tile
            name="Custom"
            checked={picked === CUSTOM}
            glyph={sliders}
            onpick={() => (picked = CUSTOM)}
          />
        </div>
      </div>
    </div>
  {/if}

  {#if picked === CUSTOM}
    <div class="o-list pane-in">
      {#each CUSTOM_SETTINGS as setting (setting)}
        <button
          class="orden-row o-row"
          type="button"
          role="switch"
          aria-checked={custom[setting]}
          onclick={() => (custom = { ...custom, [setting]: !custom[setting] })}
        >
          <span>{SETTING_NAMES[setting]}</span>
          <span class="o-toggle" aria-hidden="true"></span>
        </button>
      {/each}
    </div>
  {:else if asked}
    <div class="o-list pane-in">
      <RequestRow
        name={asked.name}
        colour={asked.colour}
        asked={requestKey('browser', asked.name)}
      />
    </div>
  {/if}

  <div class="settled" aria-live="polite">
    {#each chips as [setting, on] (setting)}
      <span class="chip">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        {SETTING_NAMES[setting]}
        <kbd>{on ? 'On' : 'Off'}</kbd>
      </span>
    {/each}
  </div>
</Screen>

<style>
  .glyph {
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .settled {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    min-height: 66px;
    align-content: flex-start;
    max-width: 560px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--card);
    border: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--text);
    animation: pop 0.45s var(--ease-spring) both;
  }

  .chip svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .chip kbd {
    font-family: var(--font-ui);
    font-size: 12.5px;
    color: var(--muted);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.85) translateY(4px);
    }
  }
</style>
