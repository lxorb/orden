<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import Answer from '../Answer.svelte'
  import { atItsCost } from '../../at-its-cost'

  const {
    text,
    draw,
    onfollow,
    onpicture,
  }: {
    text: string
    draw: (text: string) => string
    onfollow: (event: MouseEvent) => void
    onpicture: (src: string) => void
  } = $props()

  let drawnFor = untrack(() => text)
  let html = $state(untrack(() => draw(text)))

  const redraw = atItsCost(() => {
    if (drawnFor === text) return
    drawnFor = text
    html = draw(text)
  })

  $effect(() => {
    if (text !== drawnFor) redraw()
  })

  onDestroy(() => redraw.cancel())
</script>

<Answer {html} live {onfollow} {onpicture} />
