import { blank } from '@orden/pass/envelope'
import type { Content } from '@orden/pass/types'
import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu.svelte'
import { DIVIDER, menu } from '../menu.svelte'
import { contentFromTemplate, TEMPLATES } from './templates'
import type { PassUi } from './ui.svelte'

function make(ui: PassUi, content: Content): () => void {
  return () => void ui.newItem(content)
}

function templateEntries(ui: PassUi): MenuEntry[] {
  return TEMPLATES.map((one) => ({
    label: one.label(),
    run: () => void ui.newItem(contentFromTemplate(one.id)),
  }))
}

export function newItemEntries(ui: PassUi, at: { x: number; y: number }): MenuEntry[] {
  const others = () => {
    const event = new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y })
    setTimeout(() => menu.show(event, templateEntries(ui), { title: t('Other') }), 0)
  }
  return [
    { label: t('Login'), run: make(ui, blank('login')) },
    { label: t('Alias'), run: make(ui, blank('alias')) },
    { label: t('Card'), run: make(ui, blank('card')) },
    { label: t('Note'), run: make(ui, blank('note')) },
    { label: t('Identity'), run: make(ui, blank('identity')) },
    {
      label: t('Other'),
      run: others,
      more: () => Promise.resolve(templateEntries(ui)),
    },
    DIVIDER,
    { label: t('Password'), run: () => (ui.sheet = { kind: 'generator', use: null }) },
  ]
}
