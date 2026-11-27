<script lang="ts">
  import { whenLoaded } from '@orden/contracts'
  import { joining } from '../../sharing/src/api'
  import { SignIn } from '../../sign-in/src/api'
  import { settling } from '../../sync-mirror/src/api'
  import { setup } from './setup-state.svelte'

  const {
    phone = false,
    alone = true,
    name = null,
  }: { phone?: boolean; alone?: boolean; name?: string | null } = $props()
  const leave = () => (phone ? setup.finish() : setup.next('account'))
  function accepted() {
    setup.signedIn = true
    whenLoaded(settling, ({ settleLocalNotes }) => void settleLocalNotes().then(() => joining.walkThrough()))
  }
</script>

<SignIn
  {name}
  {alone}
  back={setup.canGoBack ? () => setup.back() : null}
  onaccepted={accepted}
  ondone={leave}
  onalone={leave}
/>
