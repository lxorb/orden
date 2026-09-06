import '@nib/themes'
import { mount } from 'svelte'
import App from './App.svelte'

// index.html carries it, so a missing one means the page itself is wrong -
// worth saying outright rather than mounting into nothing.
const target = document.getElementById('app')
if (!target) throw new Error('index.html has no #app to mount into')

export default mount(App, { target })
