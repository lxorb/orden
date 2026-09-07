/** The presenter's window.
 *
 *  Its own entry rather than a flag inside `main.ts`, so this window carries
 *  none of the app: no workspace, no sync, no editor, no session to restore. It
 *  is a page that listens on a channel and draws three things; see
 *  lib/slides/Presenter.svelte. */

import '@nib/themes'
import { mount } from 'svelte'
import Presenter from './lib/slides/Presenter.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('presenter.html has no #app to mount into')

export default mount(Presenter, { target })
