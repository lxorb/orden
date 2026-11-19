<script lang="ts">
  import { parseTodo, type TypedTodo } from '@orden/bases/language'
  import { region } from '../../platform/src/api'
  import { ChipInput, type Spot, type Token } from '../../ui-controls/src/api'

  /* eslint-disable prefer-const -- input is bindable, and a $props() pattern cannot be split */
  let {
    labels,
    input = $bindable(),
    class: look = '',
    ...rest
  }: {
    labels: readonly string[]
    input?: HTMLInputElement | undefined
    class?: string | undefined
    placeholder?: string
    'aria-label'?: string
    onkeydown?: (event: KeyboardEvent) => void
    onblur?: () => void
    [key: `data-${string}`]: boolean | string | undefined
  } = $props()
  /* eslint-enable prefer-const */
  let text = $state('')
  let kept = $state<Spot[]>([])
  const read = $derived(parseTodo(text, [region()], new Date(), { keep: kept }))
  const offers = (token: Token) =>
    labels
      .filter((one) => one.toLowerCase().startsWith(token.query.toLowerCase()))
      .map((one) => ({ value: one, label: one, kind: 'tag' }))
  export function taken(): TypedTodo | null {
    const said = text.trim()
    if (said === '') return null
    const out = { ...read, title: read.title.trim() || said }
    text = ''
    kept = []
    return out
  }
  export const empty = (): boolean => text.trim() === ''
</script>

<ChipInput
  bind:value={text}
  bind:kept
  bind:input
  chips={read.chips}
  signs={['#', '@', '%']}
  {offers}
  class={look}
  {...rest}
/>
