<script lang="ts">
  import { settingsWindow } from '@orden/contracts'
  import { readableSize, usage } from '../../accounts/src/api'
  import { toastDoor } from '../../ui-kit/src/api'

  const words = $derived(`${readableSize(usage.used)} of ${readableSize(usage.limit)} used.`)
  const Toast = $derived(toastDoor.one)
  $effect(() => {
    if (usage.warning) void toastDoor.ask()
  })
</script>

{#if usage.warning && Toast}
  <Toast
    {words}
    stacked
    tone="danger"
    actions={[
      { label: 'Dismiss', look: 'quiet', run: () => (usage.dismissed = true) },
      {
        label: 'Manage storage',
        run: () => {
          usage.dismissed = true
          settingsWindow().show('account')
        },
      },
    ]}
    ongone={() => (usage.dismissed = true)}
  />
{/if}
