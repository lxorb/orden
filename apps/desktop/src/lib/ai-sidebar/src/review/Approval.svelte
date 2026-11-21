<script lang="ts">
  import { alwaysOffered, crateAnswers, sayAlways } from '../chat-parts'
  import type { Part, Thread } from '../../../ai-providers/src/api'
  import { workspace } from '../../../workspace/src/api'
  import Asked from './Asked.svelte'
  import { bareName, objectOf } from '../verbs'
  import { shortcuts } from '../../../shortcuts/src/api'

  const { part, thread }: { part: Extract<Part, { kind: 'tool' }>; thread: Thread | null } = $props()
  let answering = $state(false)
  const approveKeys = $derived(shortcuts.keys('ai.approve'))
  const denyKeys = $derived(shortcuts.keys('ai.deny'))
  const root = $derived(workspace.spaces.find((one) => one.id === thread?.space)?.root ?? null)
  const asks = $derived.by(() => {
    const said = part.result?.asks?.trim()
    if (!said) return `${bareName(part.verb)} ${objectOf(part.args)}`.trim()
    return root ? said.split(`${root.replace(/[\\/]+$/, '')}/`).join('') : said
  })
  async function answer(allow: boolean, always = false) {
    const approval = part.result?.approval
    if (!approval || answering) return
    answering = true
    if (always && thread) sayAlways(thread, part.verb, part.result?.site)
    await crateAnswers.answer(approval, allow)
  }
</script>

<div class="approval">
  <p dir="auto">{asks}</p>
  <Asked {part} {thread} />
  <div class="answers">
    <button class="orden-button" disabled={answering} onclick={() => void answer(true)}
      >Approve{#if approveKeys}<kbd class="orden-keys">{approveKeys}</kbd>{/if}</button
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
      >Deny{#if denyKeys}<kbd class="orden-keys">{denyKeys}</kbd>{/if}</button
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
    container: answers / inline-size;
  }
  @container answers (width < 24rem) {
    .answers .orden-keys {
      display: none;
    }
  }
</style>
