<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { region } from '../../region'
  import { dur, slide } from '../../platform/src/api'
  import { workspace } from '../../workspace.svelte'
  import { insideSpace } from '../../platform/src/api'
  import type { Part } from '../chat/types'
  import Approval from '../review/Approval.svelte'
  import { chat } from './chat.svelte'
  import { seconds } from './numbers'
  import Spawned from './Spawned.svelte'
  import StepLine from './StepLine.svelte'
  import { bareName, helperOf, objectOf, verbOf } from './verbs'

  type Row = Extract<Part, { kind: 'thinking' | 'tool' }>
  const { part, live = false }: { part: Row; live?: boolean } = $props()

  let opened = $state(false)
  const open = $derived(opened || chat.unfolded)

  const verb = $derived.by(() => {
    if (part.kind === 'thinking') return 'Thought'
    const known = verbOf(part.verb)
    return known ?? bareName(part.verb)
  })

  const object = $derived(
    part.kind === 'thinking' ? (part.ms ? seconds(part.ms, region()) : '') : objectOf(part.args),
  )

  const going = $derived(live && (part.kind === 'thinking' ? !part.ms : part.state === 'running'))

  const helper = $derived(part.kind === 'tool' ? helperOf(part) : null)

  const command = $derived(part.kind === 'tool' && verbOf(part.verb) === 'Ran')

  const detail = $derived.by(() => {
    if (part.kind === 'thinking') return part.text.trim()
    const said = part.result?.text.trim() ?? ''
    if (command) return said ? `$ ${object}\n${said}` : `$ ${object}`
    const args = JSON.stringify(part.args ?? {}, null, 2)
    return said ? `${args}\n\n${said}` : args
  })

  async function press() {
    const change = part.kind === 'tool' ? part.change : undefined
    const root = chat.root
    if (change && root) {
      await workspace.open(insideSpace(root, change.path))
      return
    }
    opened = !opened
  }
</script>

<div class="row">
  <StepLine
    {verb}
    {object}
    {open}
    {going}
    failed={part.kind === 'tool' && part.state === 'error'}
    code={command}
    change={part.kind === 'tool' ? part.change : undefined}
    onpress={() => void press()}
  />

  {#if part.kind === 'tool' && part.state === 'asking' && part.result?.approval}
    <Approval {part} thread={chat.thread} />
  {/if}

  {#if helper && (open || going)}
    <Spawned threads={[helper]} />
  {/if}

  {#if open && detail}
    <pre
      class="detail"
      class:said={command}
      transition:slide={{ duration: dur(150), easing: cubicOut }}>{detail}</pre>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .detail {
    margin: 4px 0 2px 13px;
    padding: var(--space-2);
    max-height: 16rem;
    overflow: auto;
    border-radius: var(--radius-sm);
    background: var(--ink-wash);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .detail.said {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
  }
</style>
