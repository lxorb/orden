<script lang="ts">
  import { toastDoor } from '../../ui-kit/src/api'
  import { forget, isRecord, isString, stored } from '../../platform/src/api'
  import { OUTSIDE_FOLDER, runCommand } from '@orden/contracts'

  const said = stored(OUTSIDE_FOLDER)
  forget(OUTSIDE_FOLDER)
  const folder = isRecord(said) && isString(said.folder) ? said.folder : ''
  const left = isRecord(said) && Array.isArray(said.left) ? said.left.filter(isString) : []
  let showing = $state(folder !== '')
  const words = $derived(
    [
      `Orden no longer opens ${folder} in place. Its spaces are kept in Orden now, and the folder is left as it was. To bring in more from it, use Import.`,
      ...(left.length
        ? [
            `Not copied yet, so still only in that folder: ${left.join(', ')}. Orden tries again the next time it starts.`,
          ]
        : []),
    ].join(' '),
  )
  const Toast = $derived(toastDoor.one)
  void toastDoor.ask()
</script>

{#if showing && Toast}
  <Toast
    {words}
    stacked
    at="center"
    actions={[
      { label: 'Dismiss', look: 'quieter', run: () => (showing = false) },
      {
        label: 'Import',
        look: 'link',
        run: () => {
          showing = false
          void runCommand('import.show')
        },
      },
    ]}
    ongone={() => (showing = false)}
  />
{/if}
