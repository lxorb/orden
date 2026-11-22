import { settingFieldsIn } from '@orden/contracts'
import { isDesktop } from '../../platform/src/api'
import { hiddenTabs, isHiddenTabs } from '../../workspace/src/api'
import type { Field, Pane } from './fields'

function hiddenTabsField(): Field {
  return {
    kind: 'segmented',
    key: 'general.hiddenTabs',
    label: 'Hidden tabs',
    hint: 'What the web pages of another space do while it is out of sight: keep running, pause, or ask the first time.',
    words: ['spaces', 'background', 'pause', 'sleep', 'freeze', 'audio', 'tabs'],
    options: [
      { value: 'run', label: 'Keep running' },
      { value: 'pause', label: 'Pause' },
      { value: 'ask', label: 'Ask' },
    ],
    initial: 'ask',
    get: () => hiddenTabs.choice,
    set: (value) => hiddenTabs.set(isHiddenTabs(value) ? value : 'ask'),
  }
}
export function browserPane(): Pane {
  return {
    id: 'browser',
    label: 'Browser',
    groups: isDesktop
      ? [
          { title: '', fields: settingFieldsIn('browser', 'Browser') },
          { title: 'Performance', fields: [...settingFieldsIn('browser', 'Performance'), hiddenTabsField()] },
        ]
      : [],
  }
}
