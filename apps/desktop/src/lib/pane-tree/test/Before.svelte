<script lang="ts">
  import { workspace } from '../../workspace/src/api'
  import { failing } from './failing.svelte'

  function front(): string {
    const id = workspace.activeTabId ?? ''
    if (failing.before) throw new Error('what is drawn before the pane failed')
    return id
  }
</script>

<p class="before">{front()}</p>
