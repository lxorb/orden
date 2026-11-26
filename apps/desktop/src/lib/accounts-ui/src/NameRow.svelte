<script lang="ts">
  import { account } from '../../accounts/src/api'
  import { message } from '../../ui-kit/src/api'
  import { EditRow, EditSheet } from '../../ui-controls/src/api'

  const { label = 'Display name' }: { label?: string } = $props()
  const name = $derived(account.user ? (account.user.name ?? null) : (account.guest?.name ?? null))
  let editing = $state(false)
  let typed = $state('')
  let busy = $state(false)
  let wrong = $state<string | null>(null)
  function edit() {
    typed = name ?? ''
    wrong = null
    editing = true
  }
  async function save() {
    busy = true
    wrong = null
    try {
      await account.rename(typed.trim())
      editing = false
    } catch (error) {
      wrong = message(error, 'that did not work')
    } finally {
      busy = false
    }
  }
</script>

<EditRow {label} value={name} hint="The name the others see on what you share and in chats." onedit={edit} />
<EditSheet
  open={editing}
  title={label}
  {busy}
  {wrong}
  ready={!!typed.trim() && typed.trim() !== name}
  onsave={() => void save()}
  onclose={() => (editing = false)}
>
  <label
    >{label}<input
      class="orden-field"
      bind:value={typed}
      placeholder="Your name"
      spellcheck="false"
      data-lands
    /></label
  >
</EditSheet>
