<script module lang="ts">
  import type { IconNode } from 'lucide'

  const VERSIONS: IconNode = [
    ['rect', { x: '3', y: '3', width: '13', height: '13', rx: '2' }],
    ['rect', { x: '8', y: '8', width: '13', height: '13', rx: '2' }],
  ]
</script>

<script lang="ts">
  import { t } from '../i18n.svelte'
  import SharedMark from '../SharedMark.svelte'
  import { asking } from './asking.svelte'

  const { path }: { path: string | null } = $props()
</script>

{#if asking.isHeld(path)}
  <SharedMark label={t('Waiting for you')} icon={VERSIONS} />
{/if}
