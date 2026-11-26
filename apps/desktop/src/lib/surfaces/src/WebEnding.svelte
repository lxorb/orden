<script lang="ts">
  import { toastDoor } from '../../ui-kit/src/api'
  import { log, openExternal } from '../../platform/src/api'
  import { workspace } from '../../workspace/src/api'
  import { dismissWebEnding, exportSpaces, GET_ORDEN, WEB_ENDING, WEB_EXPORTED, webEndingDue } from './web-ending'

  let showing = $state(webEndingDue())
  let exporting = $state(false)
  let exported = $state(false)
  const Toast = $derived(toastDoor.one)
  $effect(() => {
    if (showing) void toastDoor.ask()
  })
  function dismiss() {
    dismissWebEnding()
    showing = false
  }
  async function save() {
    if (exporting) return
    exporting = true
    try {
      await workspace.savingSettled()
      await exportSpaces(workspace.shownSpaces.map((space) => space.root))
      exported = true
    } catch (error) {
      log('error', `web ending export: ${String(error)}`)
    }
    exporting = false
  }
</script>

{#if showing && Toast}
  <Toast
    words={exported ? WEB_EXPORTED : WEB_ENDING}
    stacked
    at="center"
    data-web-ending
    actions={[
      { label: 'Dismiss', look: 'quieter', run: dismiss },
      ...(exported
        ? []
        : [{ label: exporting ? 'Exporting' : 'Export', look: 'quiet' as const, run: () => void save() }]),
      { label: 'Get Orden', run: () => void openExternal(GET_ORDEN) },
    ]}
    ongone={dismiss}
  />
{/if}
