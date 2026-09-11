import '@nib/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { serveAssets } from './lib/web/asset-worker'

// Before the app, so the worker that answers for the pictures in a note is there
// by the time a note is open. Nothing at all in the app builds; see public/sw.js.
serveAssets()

// index.html carries it, so a missing one means the page itself is wrong -
// worth saying outright rather than mounting into nothing.
const target = document.getElementById('app')
if (!target) throw new Error('index.html has no #app to mount into')

export default mount(App, { target })
