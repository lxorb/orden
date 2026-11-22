<script lang="ts">
  import { settingsWindow } from '@orden/contracts'
  import { toastDoor } from '../../ui-kit/src/api'
  import { keysMoved } from './keys-moved.svelte'

  const words =
    'Orden no longer keeps AI keys in the Mac’s keychain, which kept asking for its password. Enter your keys and sign in to ChatGPT once more.'
  const Toast = $derived(toastDoor.one)
  void toastDoor.ask()
</script>

{#if keysMoved.showing && Toast}
  <Toast
    {words}
    stacked
    at="center"
    actions={[
      { label: 'Dismiss', look: 'quieter', run: () => keysMoved.dismiss() },
      {
        label: 'Settings › AI',
        look: 'link',
        run: () => {
          keysMoved.dismiss()
          settingsWindow().show('ai')
        },
      },
    ]}
    ongone={() => keysMoved.dismiss()}
  />
{/if}
