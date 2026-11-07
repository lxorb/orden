<script lang="ts">
  import { CARD_BRANDS, type Card, type CardBrand } from '@orden/pass/types'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import EditCard from './EditCard.svelte'
  import EditField from './EditField.svelte'
  import { brandLabel, brandOf } from './field-words'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let { content = $bindable(), oninput }: { content: Card; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  const brands = $derived(CARD_BRANDS.map((brand) => ({ value: brand, label: brandLabel(brand) })))

  function numberTyped() {
    const guessed = brandOf(content.number)
    if (guessed !== null) content.brand = guessed
    oninput()
  }

  function expiryTyped() {
    const digits = content.expiry.replace(/\D/g, '').slice(0, 4)
    content.expiry = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
    oninput()
  }

  function brandIn(value: string): CardBrand {
    return CARD_BRANDS.find((brand) => brand === value) ?? 'other'
  }
</script>

<EditCard>
  <EditField label={t('Name on card')} bind:value={content.holder} {oninput} />
  <EditField
    label={t('Card number')}
    bind:value={content.number}
    inputmode="numeric"
    mono
    oninput={numberTyped}
  />
  <div class="brand">
    <span class="label">{t('Card type')}</span>
    <Select
      plain
      value={content.brand}
      options={brands}
      onchange={(value: string) => {
        content.brand = brandIn(value)
        oninput()
      }}
    />
  </div>
  <EditField
    label={t('Expiration date')}
    bind:value={content.expiry}
    inputmode="numeric"
    placeholder={t('MM/YY')}
    oninput={expiryTyped}
  />
  <EditField
    label={t('Security code')}
    bind:value={content.code}
    kind="hidden"
    inputmode="numeric"
    {oninput}
  />
  <EditField
    label={t('PIN')}
    bind:value={content.pin}
    kind="hidden"
    inputmode="numeric"
    {oninput}
  />
</EditCard>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .label {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .brand > :global(:last-child) {
    flex: none;
    width: 12rem;
    max-width: 50%;
  }
</style>
