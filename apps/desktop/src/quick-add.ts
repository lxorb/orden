import './lib/backend-ports'
import './lib/platform/src/api'
import './lib/sync-base-ports'
import './lib/no-workspace-ports'
import './lib/theme-ports'
import '@orden/themes'
import { mount } from 'svelte'
import { holdComposingKeys } from './lib/ui-kit/src/api'
import { loadQuickAddWindow } from './lib/quick-add/src/api'
import { theme } from './lib/theme/src/api'

const target = document.getElementById('app')
if (!target) throw new Error('quick-add.html has no #app to mount into')

holdComposingKeys()
theme.init(false)

const { default: Window } = await loadQuickAddWindow()

export default mount(Window, { target })
