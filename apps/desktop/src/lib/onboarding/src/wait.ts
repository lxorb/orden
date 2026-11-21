import { isNative } from '../../platform/src/api'
import { setup } from './setup-state.svelte'

if (!isNative) setup.awaitAccount()
