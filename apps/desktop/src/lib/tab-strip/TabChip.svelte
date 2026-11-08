<script lang="ts">
  import TabMark from '../TabMark.svelte'
  import type { Tab } from '../workspace.svelte'

  const { tab, left, top, width }: { tab: Tab; left: number; top: number; width: number } = $props()

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }
</script>

<div
  class="chip"
  class:onbar={tab.kind === 'web'}
  use:portal
  style:width="{width}px"
  style:transform="translate({left}px, {top}px)"
  aria-hidden="true"
>
  <TabMark {tab} />
  <span class="label" dir="auto">{tab.shown}</span>
</div>

<style>
  .chip {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-carried);
    height: calc(var(--titlebar-height) - var(--tab-top, 5px));
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--shadow-md);
    pointer-events: none;
    will-change: transform;
  }

  .chip.onbar {
    background: var(--surface);
  }

  .label {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    unicode-bidi: isolate;
    --fade: min(24px, 33%);
    mask-image: linear-gradient(to right, #000 calc(100% - var(--fade)), transparent);
  }

  .label:dir(rtl) {
    mask-image: linear-gradient(to left, #000 calc(100% - var(--fade)), transparent);
  }

  [dir='auto'] {
    text-align: -webkit-match-parent;
    text-align: match-parent;
  }
</style>
