<script lang="ts">
  import { untrack } from 'svelte'
  import type { PageNode } from '@orden/markdown/canvas'
  import PagesPage from '../../src/lib/pages/src/PagesPage.svelte'

  const { first }: { first: PageNode } = $props()

  let page = $state.raw(untrack(() => first))
  let unit = $state(1)

  export function edit(next: PageNode) {
    page = next
  }

  export function zoom(next: number) {
    unit = next
  }
</script>

<PagesPage
  {page}
  number={1}
  {unit}
  notePath="/space/Note.pages"
  root="/space"
  seen={{ x: 0, y: 0, width: 794, height: 1123 }}
/>
