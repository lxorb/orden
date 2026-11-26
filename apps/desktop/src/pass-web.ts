import './lib/backend-ports'
import './lib/sync-base-ports'
import './lib/no-workspace-ports'
import './lib/theme-ports'
import '@orden/themes'
import { mount } from 'svelte'
import { loadPassWeb } from './lib/pass-ui/src/api'

const target = document.getElementById('app')
if (!target) throw new Error('pass.html has no #app to mount into')
const { default: PassWeb } = await loadPassWeb()
export default mount(PassWeb, { target })
