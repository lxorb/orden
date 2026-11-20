<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import { chorded, opensAt, overlays, walk, type Walk } from '../../ui-kit/src/api'
  import { plainOrigin } from '@orden/scan/web-address'
  import {
    asked,
    onScreen,
    type Choice,
    type DialogAsked,
    type PermissionAsked,
    type SelectAsked,
  } from './asked.svelte'
  import { ASK_NAMES } from './permissions.svelte'

  const { tab }: { tab: string } = $props()
  const dialog = $derived(asked.dialogOf(tab))
  const permission = $derived(dialog ? null : asked.permissionOf(tab))
  const select = $derived(asked.selectOf(tab))
  let typed = $derived(dialog?.default ?? '')
  function siteOf(origin: string | null): string {
    return origin ? plainOrigin(origin) : 'This page'
  }
  function asksOf(one: PermissionAsked): string {
    const names = one.asks.map((ask) => ASK_NAMES[ask].toLowerCase())
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : (names[0] ?? '')
  }
  function leaving(one: DialogAsked): { title: string; ok: string; no: string } {
    return one.reload
      ? { title: 'Reload this page?', ok: 'Reload', no: 'Stay' }
      : { title: 'Leave this page?', ok: 'Leave', no: 'Stay' }
  }
  function dialogKey(event: KeyboardEvent, one: DialogAsked) {
    if (event.key === 'Escape') {
      event.preventDefault()
      asked.answerDialog(one, false)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      asked.answerDialog(one, true, typed)
    }
  }
  function focusFirst(node: HTMLElement) {
    queueMicrotask(() => node.querySelector<HTMLElement>('input, .orden-button.is-primary')?.focus())
  }
  function focusList(node: HTMLElement) {
    queueMicrotask(() => node.focus())
  }
  let walking = $state<Walk>({ cursor: null, typed: '', typedAt: 0 })
  let hovered = $state<number | null>(null)
  let list = $state<HTMLElement>()
  const choices = $derived(select ? select.options.filter((one) => !one.disabled) : [])
  const lit = $derived(hovered ?? (walking.cursor === null ? null : (choices[walking.cursor]?.index ?? null)))
  const ROW = 32
  const MOST = 280
  const placed = $derived.by(() => {
    if (!select) return null
    const at = onScreen(select.tab, select.box, select.zoom)
    if (!at) return null
    const needed = Math.min(MOST, select.options.length * ROW + 8) + 6
    const above = at.y + at.height + needed > innerHeight && at.y - needed > 0
    return { left: at.x, top: above ? at.y - needed : at.y + at.height + 4, width: Math.max(at.width, 160), above }
  })
  const rose = { above: false }
  $effect.pre(() => {
    if (placed) rose.above = placed.above
  })
  $effect(() => {
    const one = select
    if (!one) return
    walking = opensAt(choices.findIndex((each) => each.index === one.selected))
    hovered = null
    return overlays.show(
      () => asked.pickSelect(one, null),
      () => [list],
    )
  })
  function selectKey(event: KeyboardEvent, one: SelectAsked) {
    if (chorded(event)) return
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      asked.pickSelect(one, null)
      return
    }
    const step = walk(
      event.key,
      event.timeStamp,
      choices.map((each) => each.label),
      walking,
    )
    if (step.took) event.preventDefault()
    walking = step.walk
    if (step.chose !== undefined) {
      asked.pickSelect(one, choices[step.chose]?.index ?? null)
      return
    }
    if (step.shut) {
      asked.pickSelect(one, null)
      return
    }
    hovered = null
  }
  function grouped(options: readonly Choice[]): { group: string | null; options: Choice[] }[] {
    const out: { group: string | null; options: Choice[] }[] = []
    for (const one of options) {
      const last = out.at(-1)
      if (last?.group === one.group) last.options.push(one)
      else out.push({ group: one.group, options: [one] })
    }
    return out
  }
</script>

{#if dialog}
  {@const one = dialog}
  <div
    class="orden-screen ask"
    role="alertdialog"
    aria-label={siteOf(one.origin)}
    tabindex="-1"
    use:focusFirst
    onkeydown={(event) => dialogKey(event, one)}
    transition:fly={{ y: -8, duration: dur(140), easing: cubicOut }}
  >
    {#if one.kind === 'beforeunload'}
      {@const words = leaving(one)}
      <p class="title">{words.title}</p>
      <p class="said">Changes you made may not be saved.</p>
      <div class="rows">
        <button class="orden-button is-quiet" onclick={() => asked.answerDialog(one, false)}>{words.no}</button>
        <button class="orden-button is-primary" onclick={() => asked.answerDialog(one, true)}>{words.ok}</button>
      </div>
    {:else}
      <p class="title">{siteOf(one.origin)} says</p>
      {#if one.message}<p class="said">{one.message}</p>{/if}
      {#if one.kind === 'prompt'}
        <input class="orden-field" bind:value={typed} aria-label={one.message || 'Answer'} spellcheck="false" />
      {/if}
      <div class="rows">
        {#if one.kind !== 'alert'}
          <button class="orden-button is-quiet" onclick={() => asked.answerDialog(one, false)}>Cancel</button>
        {/if}
        <button class="orden-button is-primary" onclick={() => asked.answerDialog(one, true, typed)}>OK</button>
      </div>
    {/if}
  </div>
{:else if permission}
  {@const one = permission}
  <div
    class="orden-screen ask"
    role="alertdialog"
    aria-label={siteOf(one.origin)}
    tabindex="-1"
    use:focusFirst
    onkeydown={(event) => {
      if (event.key === 'Escape') asked.answerPermission(one, false)
    }}
    transition:fly={{ y: -8, duration: dur(140), easing: cubicOut }}
  >
    <p class="title">{siteOf(one.origin)} wants to use your {asksOf(one)}</p>
    <div class="rows">
      <button class="orden-button is-quiet" onclick={() => asked.answerPermission(one, false)}>Block</button>
      <button class="orden-button is-primary" onclick={() => asked.answerPermission(one, true)}>Allow</button>
    </div>
  </div>
{/if}

{#if select && placed}
  {@const one = select}
  <ul
    class="orden-layer list"
    role="listbox"
    tabindex="-1"
    aria-label="Choices"
    bind:this={list}
    style:left="{placed.left}px"
    style:top="{placed.top}px"
    style:min-width="{placed.width}px"
    use:focusList
    onkeydown={(event) => selectKey(event, one)}
    onmouseleave={() => (hovered = null)}
    onmousedown={(event) => event.preventDefault()}
    transition:fly={{ y: rose.above ? 4 : -4, duration: dur(120), easing: cubicOut }}
  >
    {#each grouped(one.options) as part, at (at)}
      {#if part.group}<li class="group" role="presentation">{part.group}</li>{/if}
      {#each part.options as option (option.index)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          role="option"
          aria-selected={option.index === one.selected}
          aria-disabled={option.disabled}
          class:cursor={option.index === lit}
          class:chosen={option.index === one.selected}
          class:off={option.disabled}
          class:inset={part.group !== null}
          onmouseenter={() => (hovered = option.disabled ? null : option.index)}
          onclick={() => {
            if (!option.disabled) asked.pickSelect(one, option.index)
          }}
        >
          <span class="text">{option.label}</span>
          {#if option.index === one.selected}
            <svg class="tick" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
          {/if}
        </li>
      {/each}
    {/each}
  </ul>
{/if}

<style>
  .ask {
    z-index: var(--z-sheet);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    outline: none;
  }
  .title {
    margin: 0;
    font-weight: 600;
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }
  .said {
    margin: 0;
    max-height: 40vh;
    overflow-y: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .list {
    position: fixed;
    z-index: var(--z-float);
    max-height: 280px;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    list-style: none;
    outline: none;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    cursor: default;
    white-space: nowrap;
  }
  .list li.inset {
    padding-inline-start: var(--space-5);
  }
  .list li.group {
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .list li.cursor {
    background: var(--hover);
  }
  .list li.off {
    color: var(--muted);
  }
  .list .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tick {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
