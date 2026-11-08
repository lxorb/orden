<script lang="ts">
  import { t } from './i18n.svelte'
  import KindCard from './KindCard.svelte'
  import { kindLines, offeredKinds, type NewKindRow, showOthers } from './new-kinds'
  import { kindOfLetter, letterIsOurs } from './new-kind-keys'
  import { overlays } from './overlays'
  import { roving } from './roving'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'

  const { paneId, chosenOn }: { paneId: string; chosenOn?: string } = $props()

  const kinds = $derived(offeredKinds())
  const lines = $derived(kindLines(kinds))

  function choosing() {
    if (chosenOn !== undefined) workspace.chosenOn(chosenOn)
  }

  function make(one: NewKindRow) {
    choosing()
    one.make(paneId)
  }

  function others(one: NewKindRow, card: Element | null | undefined): boolean {
    return !!card && showOthers(one, card, paneId, choosing)
  }

  function choose(event: MouseEvent, one: NewKindRow) {
    const chevron = event.target instanceof Element && event.target.closest('[data-more]')
    const card = event.currentTarget instanceof Element ? event.currentTarget : null
    if ((chevron || event.shiftKey) && others(one, card)) return
    make(one)
  }

  let element = $state<HTMLElement>()

  function taken(): boolean {
    const at = document.activeElement
    if (at && at !== document.body && !element?.contains(at)) return false

    element?.querySelector('button')?.focus()
    return true
  }

  $effect(() => {
    if (chosenOn !== undefined || workspace.panes.focusedId !== paneId) return
    if (taken()) return

    const until = performance.now() + 1000
    let frame = requestAnimationFrame(function again() {
      if (!taken() && performance.now() < until) frame = requestAnimationFrame(again)
    })
    return () => cancelAnimationFrame(frame)
  })

  function hears(): boolean {
    if (workspace.panes.focusedId !== paneId || overlays.depth > 0) return false
    if (chosenOn !== undefined && workspace.showing(paneId)?.id !== chosenOn) return false

    return letterIsOurs(document.activeElement, element?.closest('[data-pane]') ?? element ?? null)
  }

  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const one = kindOfLetter(kinds, event)
      if (!one || !hears()) return

      event.preventDefault()
      event.stopPropagation()
      const card = element?.querySelector(`[data-kind="${one.kind}"]`)
      if (event.shiftKey && others(one, card)) return
      make(one)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
</script>

<div
  class="here"
  bind:this={element}
  data-new-here={paneId}
  use:roving={{ across: !viewport.touch, rows: 'button', wrap: true }}
  role="group"
  aria-label={t('New tab')}
>
  {#each lines as line (line[0]?.line)}
    <div class="line">
      {#each line as one (one.kind)}
        <KindCard
          {one}
          letter={one.letter}
          rise={kinds.indexOf(one)}
          data-kind={one.kind}
          aria-keyshortcuts={one.letter.toUpperCase()}
          onclick={(event: MouseEvent) => choose(event, one)}
          onpointerenter={() => one.ready?.()}
          onfocus={() => one.ready?.()}
        />
      {/each}
    </div>
  {/each}
</div>

<style>
  .here {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-6);
    background: var(--empty-ground, var(--bg));
    overflow: auto;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
  }

  :global([data-touch]) .here,
  :global([data-touch]) .line {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: center;
  }

  :global([data-touch]) .line {
    width: 100%;
  }
</style>
