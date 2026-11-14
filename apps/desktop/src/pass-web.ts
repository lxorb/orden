import './lib/backend-ports'
import { serveAssets } from './lib/platform/src/api'
import '@orden/themes'
import { mount } from 'svelte'
import { PassWeb } from './lib/pass-ui/src/api'

serveAssets()

const target = document.getElementById('app')
if (!target) throw new Error('pass.html has no #app to mount into')

export default mount(PassWeb, { target })
