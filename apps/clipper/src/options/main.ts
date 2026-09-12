import '../app.css'
import { mount } from 'svelte'
import Options from './Options.svelte'
import { i18n } from '../lib/i18n.svelte'
import { opening } from '../lib/opened'
import { settings } from '../lib/settings'
import { applyTheme } from '../lib/theme'

const held = await settings()
opening(held)
await i18n.use(held.language)
applyTheme(held.theme)

const target = document.getElementById('app')
if (!target) throw new Error('options.html has no #app to mount into')

export default mount(Options, { target })
