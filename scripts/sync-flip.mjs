#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'

const API = (process.env.ORDEN_API || 'https://orden.so').replace(/\/$/, '')

function say(words = '') {
  process.stdout.write(`${words}\n`)
}

async function ask(path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-nib-device': 'sync-flip',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { error: `${response.status} ${text.slice(0, 200)}` }
  }
  return { status: response.status, json }
}

async function signIn(email) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const sent = await ask('/v1/auth/code', null, { email })
    if (sent.status !== 200) throw new Error(`sign-in: ${sent.json.error ?? sent.status}`)
    const code = (await prompt.question(`code mailed to ${email}: `)).replace(/\s/g, '')
    const verified = await ask('/v1/auth/verify', null, { email, code })
    if (verified.status !== 200) throw new Error(`sign-in: ${verified.json.error}`)
    if (verified.json.token) return verified.json.token

    const second = (await prompt.question('authenticator code: ')).replace(/\s/g, '')
    const done = await ask('/v1/auth/second', null, {
      holding: verified.json.holding,
      code: second,
    })
    if (done.status !== 200 || !done.json.token) throw new Error(`sign-in: ${done.json.error}`)
    return done.json.token
  } finally {
    prompt.close()
  }
}

function when(at) {
  return at ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') : 'never'
}

function showRollout(json) {
  say(`rollout ${json.mode}${json.min ? ` (min ${json.min})` : ''}  since ${when(json.since)}`)
  if (json.accounts) say(`  accounts: v1 ${json.accounts.v1}, v2 ${json.accounts.v2}`)
  if (json.moved !== undefined)
    say(`  ${json.dry ? 'would move' : 'moved'} ${json.moved} back to v1`)
  for (const one of json.moves ?? []) {
    say(
      `  ${when(one.at)}  ${one.email}  ${one.from} -> ${one.to}  ${one.why}${one.min ? ` (min ${one.min})` : ''}`,
    )
  }
}

async function rollout(what, mode, flags, token) {
  if (what === 'everyone-to1') {
    return await ask('/v2/admin/sync-rollout/back', token, {
      everyone: true,
      ...(flags.dry ? { dry: true } : {}),
    })
  }
  if (!mode) return await ask('/v2/admin/sync-rollout', token)
  return await ask('/v2/admin/sync-rollout', token, {
    mode,
    ...(flags.min ? { min: flags.min } : {}),
  })
}

function show(answer, what) {
  const { json } = answer
  if (json.email) say(`${json.email}: sync v${json.version} (min ${json.min})`)
  for (const one of json.devices ?? []) {
    const state = one.live ? 'live' : 'signed out'
    say(
      `  device  ${one.id}  ${one.name} (${one.platform})  app ${one.app || '?'}  seen ${when(one.lastSeenAt)}  ${state}`,
    )
  }
  for (const one of json.sessions ?? []) {
    say(
      `  session ${one.id}  ${one.name || '(no name)'}  used ${when(one.lastUsedAt)}  no device${one.allowed ? '  allowed' : ''}`,
    )
  }
  const blockers = json.blockers ?? []
  if (blockers.length) {
    say(
      what === 'to1'
        ? `  too old to roll back cleanly, ${blockers.length}:`
        : `  held back by ${blockers.length}:`,
    )
    for (const one of blockers)
      say(
        `    ${one.kind} ${one.id}  ${one.name || ''}  ${one.why}${one.app ? ` (${one.app})` : ''}`,
      )
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const words = []
  const allow = []
  const flags = {}
  for (let at = 0; at < argv.length; at++) {
    const one = argv[at]
    if (one === '--allow') allow.push(argv[++at])
    else if (one === '--min' || one === '--sign-in') flags[one.slice(2)] = argv[++at]
    else if (one === '--dry') flags.dry = true
    else words.push(one)
  }
  const [what, email] = words
  const mode = email
  const everybody = what === 'rollout' || what === 'everyone-to1'
  if (
    !(everybody || (['status', 'to1', 'to2'].includes(what) && email)) ||
    (what === 'rollout' && mode && !['off', 'new', 'all'].includes(mode))
  ) {
    throw new Error(
      'usage: sync-flip.mjs status|to1|to2 <email> [--min X] [--allow id]... [--dry] [--sign-in admin@email]\n' +
        '       sync-flip.mjs rollout [off|new|all] [--min X] | everyone-to1 [--dry]',
    )
  }

  const signedIn = flags['sign-in'] ? await signIn(flags['sign-in']) : null
  const token = signedIn ?? process.env.ORDEN_TOKEN ?? ''
  if (!token) throw new Error('ORDEN_TOKEN is not set (or pass --sign-in)')

  try {
    if (everybody) {
      const answer = await rollout(what, mode, flags, token)
      if (answer.status !== 200) throw new Error(answer.json.error ?? String(answer.status))
      showRollout(answer.json)
      return
    }

    let answer
    if (what === 'status') {
      const query = new URLSearchParams({ email })
      if (flags.min) query.set('min', flags.min)
      for (const id of allow) query.append('allow', id)
      answer = await ask(`/v2/admin/sync-version?${query}`, token)
    } else {
      answer = await ask('/v2/admin/sync-version', token, {
        email,
        to: what === 'to2' ? 2 : 1,
        ...(flags.min ? { min: flags.min } : {}),
        ...(allow.length ? { allow } : {}),
        ...(flags.dry ? { dry: true } : {}),
      })
    }

    show(answer, what)
    if (answer.status === 409 && answer.json.blockers?.length) {
      say('update those apps, or name what may stay on v1 with --allow <id>')
    }
    if (answer.status !== 200) throw new Error(answer.json.error ?? String(answer.status))
    if (what !== 'status') {
      say(
        answer.json.changed
          ? `now sync v${answer.json.version}`
          : `unchanged (sync v${answer.json.version})`,
      )
    }
  } finally {
    if (signedIn) await ask('/v1/auth/signout', signedIn, {}).catch(() => undefined)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
