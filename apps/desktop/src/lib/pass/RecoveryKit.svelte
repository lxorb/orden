<script lang="ts">
  import Copy from 'lucide/dist/esm/icons/copy.mjs'
  import Download from 'lucide/dist/esm/icons/download.mjs'
  import LifeBuoy from 'lucide/dist/esm/icons/life-buoy.mjs'
  import { deliver } from '../export/save'
  import { t } from '../i18n.svelte'
  import { copyField } from './copied'
  import Gate from './Gate.svelte'
  import Glyph from './Glyph.svelte'

  const { code, ondone }: { code: string; ondone: () => void } = $props()

  function saved() {
    const text = `${t('Orden Pass recovery key')}\n\n${code}\n`
    void deliver(t('Orden Pass recovery key'), 'txt', t('Text'), { text, mime: 'text/plain' })
  }
</script>

<Gate
  icon={LifeBuoy}
  title={t('Your recovery key')}
  line={t(
    'It opens Pass if you forget your password. Keep it somewhere safe, away from this device.',
  )}
>
  <output class="code" dir="ltr" aria-label={t('Recovery key')}>{code}</output>
  <div class="row">
    <button
      class="orden-button is-quiet is-soft"
      type="button"
      onclick={() => void copyField(t('Recovery key'), code)}
    >
      <Glyph icon={Copy} />{t('Copy')}
    </button>
    <button class="orden-button is-quiet is-soft" type="button" onclick={saved}>
      <Glyph icon={Download} />{t('Download')}
    </button>
  </div>
  <button class="orden-button" type="button" onclick={ondone}>{t('I saved it')}</button>
</Gate>

<style>
  .code {
    display: block;
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1.6;
    letter-spacing: 0.04em;
    color: var(--text-strong);
    overflow-wrap: anywhere;
    -webkit-user-select: all;
    user-select: all;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
</style>
