<script lang="ts">
  import type { SshKey } from '@orden/pass/types'
  import { sshFingerprint, sshPublicOf } from '@orden/pass/ssh'
  import { t } from '../i18n.svelte'
  import FieldRow from './FieldRow.svelte'

  const { content }: { content: SshKey } = $props()

  let print = $state<string | null>(null)

  $effect(() => {
    const line = content.publicKey.trim() || (sshPublicOf(content.privateKey) ?? '')
    let current = true
    void sshFingerprint(line).then((found) => {
      if (current) print = found
    })
    return () => {
      current = false
    }
  })
</script>

{#if print}
  <section class="card">
    <FieldRow label={t('Fingerprint')} value={print} mono />
  </section>
{/if}

<style>
  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }
</style>
