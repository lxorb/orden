<script lang="ts">
  import type { Field } from '@orden/pass/types'
  import { totpIn } from '@orden/pass/totp'
  import { t } from '../i18n.svelte'
  import EditField from './EditField.svelte'
  import { fieldShape } from './new-field'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let { fields = $bindable(), oninput }: { fields: Field[]; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  function wrong(field: Field): string | null {
    return field.kind === 'totp' && field.value.trim() !== '' && totpIn(field.value) === null
      ? t('This is not a 2FA secret or setup address.')
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
    bind:label={field.name}
    bind:value={field.value}
    kind={fieldShape(field.kind)}
    mono={field.kind === 'totp'}
    invalid={wrong(field)}
    {oninput}
    onremove={() => remove(field.id)}
  />
{/each}
