import './lib/former-keys'
import '@orden/themes'
import { mount } from 'svelte'
import Presenter from './lib/slides/Presenter.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('presenter.html has no #app to mount into')

export default mount(Presenter, { target })
