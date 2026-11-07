import './lib/former-keys'
import '@orden/themes'
import { mount } from 'svelte'
import { i18n } from './lib/i18n.svelte'
import { holdComposingKeys } from './lib/keys'
import Window from './lib/quick-add/Window.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('quick-add.html has no #app to mount into')

i18n.restore()
holdComposingKeys()

export default mount(Window, { target })
