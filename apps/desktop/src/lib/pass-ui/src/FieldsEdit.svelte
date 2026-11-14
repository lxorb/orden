<script lang="ts">
  import type { Field } from '@orden/pass/types'
  import { totpIn } from '@orden/pass/totp'
  import EditField from './EditField.svelte'
  import { fieldKindIcon } from '../../pass-sync/src/api'
  import { fieldShape } from '../../pass-sync/src/api'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let { fields = $bindable(), oninput }: { fields: Field[]; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  function wrong(field: Field): string | null {
    return field.kind === 'totp' && field.value.trim() !== '' && totpIn(field.value) === null
      ? 'This is not a 2FA secret or setup address.'
      : null
  }

  function remove(id: string) {
    fields = fields.filter((one) => one.id !== id)
    oninput()
  }
</script>

{#each fields as field (field.id)}
  <EditField
    named
    icon={fieldKindIcon(field.kind)}
    bind:label={field.name}
    bind:value={field.value}
    kind={fieldShape(field.kind)}
    mono={field.kind === 'totp'}
    invalid={wrong(field)}
    {oninput}
    onremove={() => remove(field.id)}
  />
{/each}
