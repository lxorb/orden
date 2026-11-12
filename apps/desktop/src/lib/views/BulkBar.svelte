<script lang="ts">
  import type { Row } from '@orden/bases'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Folder from 'lucide/dist/esm/icons/folder-input.mjs'
  import Tag from 'lucide/dist/esm/icons/tag.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { localNumber } from '../region'
  import { menu } from '../menu.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import Glyph from '../quick-add/Glyph.svelte'
  import type { Kit } from './kit'
  import type { Box } from './schedule/scheduling.svelte'
  import {
    labelEntries,
    moveEntries,
    prioritise,
    priorityEntries,
    scheduleRows,
    taskMenu,
  } from './task-actions'

  const { rows, kit, onclear }: { rows: readonly Row[]; kit: Kit; onclear: () => void } = $props()

  const boxOf = (event: MouseEvent): Box =>
    event.currentTarget instanceof Element
      ? event.currentTarget.getBoundingClientRect()
      : { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }
</script>

<div class="holder">
  <div class="orden-bar bar" role="toolbar" aria-label="{localNumber(rows.length)} selected">
    <span class="count">{localNumber(rows.length)} selected</span>
    <button
      type="button"
      title={shortcuts.tooltip('Schedule', 'tasks.schedule')}
      aria-label="Schedule"
      onclick={(event) => scheduleRows(rows, boxOf(event), kit, onclear)}
      ><Glyph icon={Calendar} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip('Move to', 'tasks.move')}
      aria-label="Move to"
      onclick={(event) => menu.show(event, moveEntries(rows))}><Glyph icon={Folder} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip('Labels', 'tasks.labels')}
      aria-label="Labels"
      onclick={(event) => menu.show(event, labelEntries(rows))}><Glyph icon={Tag} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip('Priority', 'tasks.priority')}
      aria-label="Priority"
      onclick={(event) =>
        menu.show(
          event,
          priorityEntries(0, (priority) => void prioritise(rows, priority)),
        )}><Glyph icon={Flag} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip('More', 'tasks.more')}
      aria-label="More"
      onclick={(event) => taskMenu(event, rows, kit)}><Glyph icon={Ellipsis} /></button
    >
    <button type="button" title="Cancel" aria-label="Cancel" onclick={onclear}
      ><Glyph icon={X} /></button
    >
  </div>
</div>

<style>
  .holder {
    position: sticky;
    bottom: 0;
    z-index: var(--z-raised);
    height: 0;
  }

  .bar {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    align-items: center;
    translate: -50% 0;
    animation: rise var(--dur-fast) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% 6px;
    }
  }

  .count {
    padding-inline: var(--space-2) var(--space-1);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .bar button {
    display: grid;
    place-items: center;
  }
</style>
