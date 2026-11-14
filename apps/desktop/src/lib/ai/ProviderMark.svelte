<script lang="ts">
  import Server from 'lucide/dist/esm/icons/server.mjs'
  import Icon from '../Icon.svelte'
  import { brandIcon, readIcon } from '../ui-kit/src/api'
  import { accountBrand } from './provider-brand'
  import type { Provider } from './providers'

  const { account }: { account: Pick<Provider, 'kind' | 'baseUrl' | 'name'> } = $props()

  const brand = $derived(accountBrand(account))
</script>

<span class="mark" aria-hidden="true" data-brand={brand ?? ''}
  ><Icon
    icon={brand === null ? null : readIcon(brandIcon(brand))}
    fallback={account.kind === 'compatible' ? Server : null}
  /></span
>

<style>
  .mark {
    flex: none;
    display: inline-block;
    width: var(--mark, var(--icon-md));
    height: var(--mark, var(--icon-md));
    vertical-align: -0.2em;
    stroke: currentColor;
    stroke-width: 1.6;
  }
</style>
