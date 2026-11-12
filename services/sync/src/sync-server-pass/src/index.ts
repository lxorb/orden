import { Hono } from 'hono'
import type { Env, Variables } from '../../sync-server/src/api'
import { changes } from './changes'
import { files } from './files'
import { invites } from './invites'
import { items } from './items'
import { keyrings } from './keyring'
import { links } from './links'
import { members } from './members'
import { moves } from './move'
import { rotations } from './rotate'
import { vaults } from './vaults'

export const pass = new Hono<{ Bindings: Env; Variables: Variables }>()

pass.route('/', changes)
pass.route('/', keyrings)
pass.route('/', vaults)
pass.route('/', items)
pass.route('/', moves)
pass.route('/', members)
pass.route('/', invites)
pass.route('/', rotations)
pass.route('/', links)
pass.route('/', files)

export { openLink } from './open-link'
export { sweepPassLinks } from './links'
