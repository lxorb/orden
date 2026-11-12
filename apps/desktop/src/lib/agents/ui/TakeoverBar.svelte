<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../motion'
  import { started } from './live.svelte'
  import Spark from './Spark.svelte'

  const { id, reason }: { id: string; reason: string } = $props()

  const activity = started()
  const approval = $derived(activity.seen.approvals.find((one) => one.id === id) ?? null)

  function done() {
    if (approval) void activity.answer(approval, true).catch(() => undefined)
  }
</script>

<div class="takeover" transition:slide={{ duration: dur(140), easing: cubicOut }}>
  {#if approval}
    <Spark colour={activity.colourOf(approval.agent)} paused />
  {/if}
  <span class="reason">{reason}</span>
  <button class="orden-button" onclick={done}>Done</button>
</div>

<style>
  .takeover {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .reason {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
