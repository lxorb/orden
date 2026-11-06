import { t } from '../i18n.svelte'
import { log } from '../log'
import { notify } from '../notify'
import type { Field } from './fields'

class Declared {
  path = $state<string | null>(null)
  held = $state<ReadonlySet<string>>(new Set())
  problems = $state<string[]>([])

  holds(key: string | undefined): boolean {
    return key !== undefined && this.path !== null && this.held.has(key)
  }

  lock(field: Field): Field {
    if (!this.holds(field.key) || !this.path) return field
    const declared = this.path
    switch (field.kind) {
      case 'switch':
        return { ...field, declared, locked: () => true, set: () => undefined }
      case 'slider':
        return { ...field, declared, preview: () => undefined, set: () => undefined }
      case 'swatches': {
        const rest = { ...field }
        delete rest.pair
        return { ...rest, declared, set: () => undefined }
      }
      case 'select':
      case 'segmented':
      case 'text':
        return { ...field, declared, set: () => undefined }
      case 'picture':
      case 'value':
        return field
    }
  }

  tell(open: () => void): void {
    if (!this.problems.length) return
    notify(t('The settings file has a problem'), this.problems.join('\n'), 'settings-file', open)
  }

  said(problems: string[]): void {
    this.problems = problems
    for (const one of problems) log('warn', `settings file: ${one}`)
  }
}

export const declared = new Declared()

export function shortcutKey(id: string): string {
  return `shortcuts.${id.replaceAll('.', '-')}`
}
