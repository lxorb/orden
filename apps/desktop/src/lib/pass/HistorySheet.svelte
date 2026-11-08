<script lang="ts">
  import type { Item } from '@orden/pass/types'
  import { i18n, message, t } from '../i18n.svelte'
  import { prompt } from '../prompt.svelte'
  import Sheet from '../Sheet.svelte'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'

  const { ui }: { ui: PassUi } = $props()

  const asked = $derived(ui.sheet?.kind === 'history' ? ui.sheet : null)
  let versions = $state.raw<Item[] | null>(null)
  let wrong = $state('')

  $effect(() => {
    const id = asked?.item
    versions = null
    wrong = ''
    if (!id) return
    let current = true
    pass
      .history(id)
      .then((found) => {
        if (current) versions = found
      })
      .catch((error: unknown) => {
        if (current) wrong = message(error, 'The history could not be read.')
      })
    return () => {
      current = false
    }
  })

  const close = () => (ui.sheet = null)
  const when = (stamp: number) => i18n.when(stamp, { dateStyle: 'medium', timeStyle: 'short' })

  async function restored(rev: number) {
    if (!asked) return
    await pass.restoreVersion(asked.item, rev)
    close()
  }

  async function cleared() {
    if (!asked) return
    const sure = await prompt.confirm({
      title: t('Clear the history?'),
      detail: t('The older versions are deleted for good.'),
      confirmLabel: t('Clear history'),
      danger: true,
    })
    if (!sure) return
    await pass.clearHistory(asked.item)
    versions = []
  }
</script>

<Sheet open={asked !== null} title={t('History')} onclose={close}>
  {#if wrong}
    <p class="quiet" role="alert">{wrong}</p>
  {:else if versions === null}
    <p class="quiet">{t('Reading…')}</p>
  {:else if versions.length === 0}
    <p class="quiet">{t('No older versions')}</p>
  {:else}
    <div class="versions">
      {#each versions as version (version.rev)}
        <div class="orden-setting version">
          <span class="name">
            <span class="title">{version.content.title || t('Untitled')}</span>
            <span class="when">{when(version.modified)}</span>
          </span>
          <button class="orden-chip" type="button" onclick={() => void restored(version.rev)}>
            {t('Restore')}
          </button>
        </div>
      {/each}
    </div>
    <button class="orden-action is-danger" type="button" onclick={() => void cleared()}
      >{t('Clear history')}</button
    >
  {/if}
</Sheet>

<style>
  .versions {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .version {
    padding: var(--space-2) var(--space-3);
  }

  .version + .version {
    border-top: 1px solid var(--line);
  }

  .title {
    display: block;
    color: var(--text-strong);
  }

  .when {
    display: block;
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .quiet {
    margin: 0;
    padding: var(--space-4);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: center;
  }
</style>
