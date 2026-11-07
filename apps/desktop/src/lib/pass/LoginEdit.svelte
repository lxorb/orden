<script lang="ts">
  import { totpIn } from '@orden/pass/totp'
  import type { Login } from '@orden/pass/types'
  import { t } from '../i18n.svelte'
  import EditCard from './EditCard.svelte'
  import EditField from './EditField.svelte'
  import { FIELD_ICONS } from './field-icons'
  import PasswordField from './PasswordField.svelte'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'
  import WebsitesEdit from './WebsitesEdit.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let {
    ui,
    content = $bindable(),
    oninput,
  }: { ui: PassUi; content: Login; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  const withUsername = $derived(pass.settings.showUsernameField || content.username !== '')
  const totpWrong = $derived(
    content.totp.trim() !== '' && totpIn(content.totp) === null
      ? t('This is not a 2FA secret or setup address.')
      : null,
  )
</script>

<EditCard>
  <EditField
    label={withUsername ? t('Email') : t('Email or username')}
    icon={FIELD_ICONS.email}
    bind:value={content.email}
    inputmode="email"
    {oninput}
  />
  {#if withUsername}
    <EditField
      label={t('Username')}
      icon={FIELD_ICONS.username}
      bind:value={content.username}
      {oninput}
    />
  {/if}
  <PasswordField {ui} label={t('Password')} bind:value={content.password} onchange={oninput} />
  <EditField
    label={t('2FA secret key (TOTP)')}
    icon={FIELD_ICONS.totp}
    bind:value={content.totp}
    kind="hidden"
    mono
    invalid={totpWrong}
    {oninput}
  />
</EditCard>

<EditCard>
  <WebsitesEdit bind:websites={content.websites} {oninput} />
</EditCard>
