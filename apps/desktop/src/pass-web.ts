import './lib/former-keys'
import '@orden/themes'
import { mount } from 'svelte'
import PassWeb from './lib/pass/web/PassWeb.svelte'
import { serveAssets } from './lib/web/asset-worker'

serveAssets()

const target = document.getElementById('app')
if (!target) throw new Error('pass.html has no #app to mount into')

export default mount(PassWeb, { target })
