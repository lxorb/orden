<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { message, t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { settings } from '../settings.svelte'
  import { invoke } from '../tauri'

  let is = $state<boolean | null>(null)

  async function check() {
    is = await invoke<boolean>('default_browser').catch(() => false)
  }

  async function make() {
    settings.error = null
    try {
      await invoke('make_default_browser')
    } catch (error) {
      settings.error = message(error, 'that did not work')
    }
    await check()
  }

  onMount(() => {
    void check()

    let stop: (() => void) | null = null
    let gone = false
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) void check()
        }),
      )
      .then((unlisten) => {
        if (gone) unlisten()
        else stop = unlisten
      })
      .catch(() => undefined)

    return () => {
      gone = true
      stop?.()
    }
  })
</script>

{#if is === true}
  <svg
    class="tick"
    viewBox="0 0 16 16"
    role="img"
    aria-label={t('Default')}
    in:fade={{ duration: dur(120) }}
  >
    <path d="M3 8.5l3.2 3.2L13 5" />
  </svg>
{:else if is === false}
  <button class="nib-chip" in:fade={{ duration: dur(120) }} onclick={() => void make()}>
    {t('Make default')}
  </button>
{/if}

<style>
  .tick {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
