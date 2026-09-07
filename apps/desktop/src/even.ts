/** Nib as an Even Realities plugin.
 *
 *  The same app: the same components, the same stores, the same browser storage,
 *  the same sign-in and the same sync. One thing is added and nothing is taken
 *  away - a bridge that keeps the G2 showing whatever note is active here. See
 *  lib/even and docs/even.md.
 *
 *  A separate entry rather than a flag inside `main.ts` so that the plain web
 *  build carries none of it: nothing in `index.html` reaches this file, so the
 *  Even Hub SDK and the glasses renderer are in chunks the editor never asks
 *  for. */

import '@nib/themes'
import { mount } from 'svelte'
import App from './App.svelte'
import { account } from './lib/account.svelte'
import Glasses from './lib/even/Glasses.svelte'
import { bridge } from './lib/even/bridge.svelte'
import { diagnosis } from './lib/even/diagnosis.svelte'
import { everywhere } from './lib/even/keep'

const target = document.getElementById('app')
if (!target) throw new Error('even.html has no #app to mount into')

// Before the app, because mounting it is what restores the session, and a packed
// plugin's page has no store it can count on. See lib/even/keep.ts.
account.alsoKeepIn(everywhere)

// Counts this launch and reads what the last one left, which is how one
// screenshot answers whether anything survives at all.
void diagnosis.start()

const app = mount(App, { target })
// After the app, so the workspace has restored its tabs before the glasses are
// asked what is active.
const corner = mount(Glasses, { target })
bridge.start()

export default { app, corner }
