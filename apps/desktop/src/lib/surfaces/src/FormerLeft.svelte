<script lang="ts">
  import { settingsWindow } from '@orden/contracts'
  import { formerLeftDoor } from '../../launch/src/api'
  import { toastDoor } from '../../ui-kit/src/api'

  type Held = Awaited<ReturnType<typeof formerLeftDoor>>['formerLeft']
  let held = $state<Held | null>(null)
  void formerLeftDoor().then((one) => (held = one.formerLeft))
  const words = $derived(held?.said.toast ?? '')
  const Toast = $derived(toastDoor.one)
  void toastDoor.ask()
</script>

{#if held?.showing && Toast}
  <Toast
    {words}
    stacked
    at="center"
    actions={[
      { label: 'Dismiss', look: 'quieter', run: () => held?.dismiss() },
      {
        label: 'Show in Settings',
        look: 'link',
        run: () => {
          held?.dismiss()
          settingsWindow().show('general')
        },
      },
    ]}
    ongone={() => held?.dismiss()}
  />
{/if}
