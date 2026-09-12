import '../app.css'
import { mount } from 'svelte'
import Popup from './Popup.svelte'
import { i18n } from '../lib/i18n.svelte'
import { opening } from '../lib/opened'
import { settings } from '../lib/settings'
import { applyTheme } from '../lib/theme'

// One read of storage and the catalogue it names, before anything is drawn, so
// the popup opens already in the right language and the right scheme instead of
// flashing into them. The two are all there is between opening and the first
// frame.
const held = await settings()
opening(held)
await i18n.use(held.language)
applyTheme(held.theme)

const target = document.getElementById('app')
if (!target) throw new Error('popup.html has no #app to mount into')

export default mount(Popup, { target })
