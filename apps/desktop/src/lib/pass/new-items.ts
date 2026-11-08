import { blank } from '@orden/pass/envelope'
import type { Content } from '@orden/pass/types'
import WandSparkles from 'lucide/dist/esm/icons/wand-sparkles.mjs'
import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu.svelte'
import { DIVIDER, menu } from '../menu.svelte'
import { KIND_ICONS } from './icons'
import { pass } from './store.svelte'
import { contentFromTemplate, TEMPLATES } from './templates'
import type { PassUi } from './ui.svelte'

function make(ui: PassUi, content: Content): () => void {
  return () => void ui.newItem(content)
}

function templateEntries(ui: PassUi): MenuEntry[] {
  return TEMPLATES.map((one) => ({
    label: one.label(),
    icon: one.icon,
    run: () => void ui.newItem(contentFromTemplate(one.id)),
  }))
}

export function newItemEntries(ui: PassUi, at: { x: number; y: number }): MenuEntry[] {
  const others = () => {
    const event = new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y })
    setTimeout(
      () => menu.show(event, templateEntries(ui), { until: pass.opened, title: t('Other') }),
      0,
    )
  }
  return [
    { label: t('Login'), icon: KIND_ICONS.login, run: make(ui, blank('login')) },
    { label: t('Alias'), icon: KIND_ICONS.alias, run: make(ui, blank('alias')) },
    { label: t('Card'), icon: KIND_ICONS.card, run: make(ui, blank('card')) },
    { label: t('Note'), icon: KIND_ICONS.note, run: make(ui, blank('note')) },
    { label: t('Identity'), icon: KIND_ICONS.identity, run: make(ui, blank('identity')) },
    {
      label: t('Other'),
      icon: KIND_ICONS.custom,
      run: others,
      more: () => Promise.resolve(templateEntries(ui)),
    },
    DIVIDER,
    {
      label: t('Password'),
      icon: WandSparkles,
      run: () => (ui.sheet = { kind: 'generator', use: null }),
    },
  ]
}
