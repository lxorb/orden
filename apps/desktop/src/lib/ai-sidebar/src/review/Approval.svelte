<script lang="ts">
  import { alwaysOffered, crateAnswers, sayAlways } from '../chat-parts'
  import type { Part, Thread } from '../../../ai-providers/src/api'
  import Asked from './Asked.svelte'

  const { part, thread }: { part: Extract<Part, { kind: 'tool' }>; thread: Thread | null } =
    $props()

  let answering = $state(false)

  async function answer(allow: boolean, always = false) {
    const approval = part.result?.approval
    if (!approval || answering) return
    answering = true
    if (always && thread) sayAlways(thread, part.verb, part.result?.site)
    await crateAnswers.answer(approval, allow)
  }
</script>

<div class="approval">
  {#if part.result?.text}<p>{part.result.text}</p>{/if}
  <Asked {part} />
  <div class="answers">
    <button class="orden-button" disabled={answering} onclick={() => void answer(true)}
      >Approve</button
    >
    {#if thread && alwaysOffered(part.result?.category)}
      <button
        class="orden-button is-quiet"
        disabled={answering}
        title="Always in this thread"
        onclick={() => void answer(true, true)}>Always</button
      >
    {/if}
    <button class="orden-button is-quiet" disabled={answering} onclick={() => void answer(false)}
      >Deny</button
    >
  </div>
</div>

<style>
  .approval {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 4px 0 2px 13px;
    padding: var(--space-2);
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  p {
    margin: 0;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .answers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
