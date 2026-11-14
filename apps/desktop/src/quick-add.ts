import './lib/former-keys'
import '@orden/themes'
import { mount } from 'svelte'
import { holdComposingKeys } from './lib/ui-kit/src/api'
import Window from './lib/quick-add/Window.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('quick-add.html has no #app to mount into')

holdComposingKeys()

export default mount(Window, { target })
