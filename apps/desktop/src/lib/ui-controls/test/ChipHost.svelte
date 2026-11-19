<script lang="ts">
  import { untrack } from 'svelte'
  import ChipInput from '../src/ChipInput.svelte'
  import type { Marked, Spot } from '../src/chip-field'

  const { start = '', onkey }: { start?: string; onkey?: (event: KeyboardEvent) => void } = $props()
  let text = $state(untrack(() => start))
  let kept = $state<Spot[]>([])
  const chips = $derived.by(() => {
    const out: Marked[] = []
    for (const word of text.matchAll(/\S+/gu)) {
      const from = word.index
      const to = from + word[0].length
      if (kept.some((span) => span.from < to && span.to > from)) continue
      if (word[0].startsWith('#')) out.push({ kind: 'tag', from, to })
      else if (word[0] === 'tomorrow') out.push({ kind: 'when', from, to })
    }
    return out
  })
  const offers = (token: { query: string }) =>
    ['family', 'farm', 'work']
      .filter((name) => name.startsWith(token.query))
      .map((name) => ({ value: name, label: name, kind: 'tag' }))
</script>

<ChipInput
  bind:value={text}
  bind:kept
  {chips}
  signs={['#']}
  {offers}
  aria-label="Add todo"
  onkeydown={onkey}
  data-host
/>
<output data-kept={JSON.stringify(kept)}>{text}</output>
