import { settingFieldsIn } from '@orden/contracts'
import { isDesktop } from '../../platform/src/api'
import type { Pane } from './fields'

export function terminalPane(): Pane {
  return {
    id: 'terminal',
    label: 'Terminal',
    groups: isDesktop ? [{ title: '', fields: settingFieldsIn('terminal', 'Terminal') }] : [],
  }
}
