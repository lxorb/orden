<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { LAYER } from './motion'
  import { overlays } from './overlays'
  import { roving } from './roving'
  import SpaceList from './SpaceList.svelte'
  import { spacePicker } from './space-picker.svelte'
  import { SpaceTyping } from './space-typing.svelte'
  import { trap } from './trap'
  import { type Space, workspace } from './workspace.svelte'

  $effect(() => (spacePicker.open ? overlays.show(() => spacePicker.dismiss()) : undefined))
  $effect(() => closeOnBack(spacePicker.open, () => spacePicker.dismiss()))

  const typing = $derived(
    spacePicker.open ? new SpaceTyping((space) => spacePicker.choose(space)) : null,
  )
  $effect(() => {
    const one = typing
    return () => one?.stop()
  })
</script>

{#if typing}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => spacePicker.dismiss()}
  ></div>

  <div
    class="nib-screen is-centred is-steady picker"
    style:--rows={workspace.shownSpaces.length}
    data-spaces-open
    role="menu"
    aria-label={t('Spaces')}
    use:trap
    use:roving={{ current: '.is-on', wrap: true, held: true }}
    onkeydowncapture={typing.press}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <SpaceList {typing} choose={(space: Space) => spacePicker.choose(space)} />
  </div>
{/if}

<style>
  .picker {
    --screen-width: var(--screen-sheet);
    --screen-height: calc(var(--rows) * var(--row-height) + 2 * var(--space-1) + 2px);
    z-index: var(--z-sheet);
    padding: var(--space-1);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }
</style>
