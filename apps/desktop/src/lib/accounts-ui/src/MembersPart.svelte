<script lang="ts">
  import { untrack } from 'svelte'
  import { workspaceView } from '@orden/contracts'
  import { samePath } from '../../platform/src/api'
  import { managesSpace, members } from '../../sharing/src/api'
  import MemberRows from './MemberRows.svelte'
  import { membersRoot } from './shell-parts'

  const root = $derived(membersRoot())
  $effect(() => {
    const at = root
    if (at === null) return
    untrack(() => {
      const space = workspaceView().spaces.find((one) => samePath(one.root, at))
      if (space) void members.look(space)
    })
  })
</script>

{#if members.error}
  <div class="orden-setting setting"><span class="name wrong">{members.error}</span></div>
{/if}
{#if members.seats}
  <div class="orden-setting setting">
    <span class="name seats">{members.seats.used} of {members.seats.most} places used</span>
  </div>
{/if}
<MemberRows store={members} manages={root !== null && managesSpace(root)} titled={false} />

<style>
  .seats {
    color: var(--muted);
  }
  .wrong {
    color: var(--danger);
  }
</style>
