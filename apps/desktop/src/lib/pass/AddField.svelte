<script lang="ts">
  import { FIELD_KINDS, type FieldKind } from '@orden/pass/types'
  import Plus from 'lucide/dist/esm/icons/plus.mjs'
  import { menu } from '../menu.svelte'
  import { fieldKindLabel } from './field-words'
  import Glyph from './Glyph.svelte'
  import { pass } from './store.svelte'

  const { onadd, label }: { onadd: (kind: FieldKind) => void; label?: string } = $props()

  function show(event: MouseEvent) {
    menu.show(
      event,
      FIELD_KINDS.map((kind) => ({ label: fieldKindLabel(kind), run: () => onadd(kind) })),
      { until: pass.opened },
    )
  }
</script>

<button type="button" class="orden-button is-quiet add" onclick={show}>
  <Glyph icon={Plus} />
  <span>{label ?? 'Add field'}</span>
</button>

<style>
  .add {
    align-self: flex-start;
    padding-inline: var(--space-2);
    font-size: var(--text-sm);
  }
</style>
