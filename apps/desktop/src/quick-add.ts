import './lib/former-keys'
import '@orden/themes'
import { mount } from 'svelte'
import { holdComposingKeys } from './lib/ui-kit/src/api'
import { loadQuickAddWindow } from './lib/quick-add/src/api'

const target = document.getElementById('app')
if (!target) throw new Error('quick-add.html has no #app to mount into')

holdComposingKeys()

const { default: Window } = await loadQuickAddWindow()

export default mount(Window, { target })
