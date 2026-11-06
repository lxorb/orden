<script lang="ts">
  import { said } from '../../src/lib/said.svelte'

  interface Props {
    status: 'idle' | 'syncing' | 'error'
    saving: 'idle' | 'saving' | 'saved'
  }

  const { status, saving }: Props = $props()

  $effect(() => {
    if (status === 'syncing') said.say('Syncing')
    else if (status === 'error') said.say('Sync failed')
  })

  $effect(() => {
    if (saving === 'saving') said.say('Saving')
    else if (saving === 'saved') said.say('Saved')
  })
</script>

<p data-said role="status" aria-live="polite">{said.words}</p>
<p data-saving>{saving}</p>
