<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { Screen } from '../../sign-in/src/api'
  import { setup } from './setup-state.svelte'

  type Props = Omit<ComponentProps<typeof Screen>, 'back'> & { onback?: (() => void) | null; backless?: boolean }
  const { onback = null, backless = false, ...rest }: Props = $props()
  const back = $derived(backless ? null : (onback ?? (setup.canGoBack ? () => setup.back() : null)))
</script>

<Screen {...rest} {back} />
