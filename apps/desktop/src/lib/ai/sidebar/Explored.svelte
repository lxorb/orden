<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../platform/src/api'
  import type { Part } from '../../ai-providers/src/api'
  import { chat } from './chat.svelte'
  import PartRow from './PartRow.svelte'
  import StepLine from './StepLine.svelte'
  import { objectOf } from './verbs'

  const { rows, live = false }: { rows: Extract<Part, { kind: 'tool' }>[]; live?: boolean } =
    $props()

  let opened = $state(false)
  const open = $derived(opened || chat.unfolded)
  const going = $derived(live && rows.some((one) => one.state === 'running'))
  const what = $derived([...new Set(rows.map((one) => objectOf(one.args)).filter(Boolean))])
</script>

<div class="row">
  <StepLine
    verb="Explored"
    object={what.join(', ')}
    {open}
    {going}
    onpress={() => (opened = !opened)}
  />
  {#if open}
    <div class="inner" transition:slide={{ duration: dur(150), easing: cubicOut }}>
      {#each rows as one, at (at)}
        <PartRow part={one} {live} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 0 13px;
  }
</style>
