import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'

const KNOWN = ['2025-06-18', '2025-03-26', '2024-11-05']
const PAGE = 2
const tools = [
  {
    name: 'echo',
    description: 'Says the text back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add',
    description: 'Adds a and b',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
  { name: 'shout', description: 'Says the text loudly', inputSchema: { type: 'object' } },
  {
    name: 'slow',
    description: 'Answers after ms',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
  { name: 'crash', description: 'Stops the server', inputSchema: { type: 'object' } },
  { name: 'grow', description: 'Adds a tool', inputSchema: { type: 'object' } },
  { name: 'family', description: 'Starts a child that stays', inputSchema: { type: 'object' } },
]
if (process.env.FAKE_SECRET)
  tools.push({ name: 'whoami', description: 'Says the secret', inputSchema: { type: 'object' } })
const text = (said) => ({ content: [{ type: 'text', text: String(said) }] })
const later = (ms) => new Promise((done) => setTimeout(done, ms))
async function called(name, args, secret, changed) {
  switch (name) {
    case 'echo':
      return text(args.text)
    case 'add':
      return { ...text(args.a + args.b), structuredContent: { sum: args.a + args.b } }
    case 'shout':
      return text(String(args.text).toUpperCase())
    case 'slow':
      await later(Number(args.ms))
      return text('done')
    case 'crash':
      process.stderr.write('boom: the fake server fell over\n')
      setTimeout(() => process.exit(3), 10)
      return text('falling')
    case 'grow':
      if (!tools.some((one) => one.name === 'extra')) tools.push({ name: 'extra', inputSchema: { type: 'object' } })
      setTimeout(changed, 10)
      return text('grown')
    case 'family': {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      return text(child.pid)
    }
    case 'whoami':
      if (secret) return text(secret)
      return { ...text('no secret'), isError: true }
    default:
      return { ...text(`no tool ${name}`), isError: true }
  }
}
async function answered(message, secret, changed) {
  const { id, method, params = {} } = message
  if (id === undefined || method === undefined) return null
  const reply = (result) => ({ jsonrpc: '2.0', id, result })
  switch (method) {
    case 'initialize': {
      const asked = process.env.FAKE_PROTOCOL ?? params.protocolVersion
      return reply({
        protocolVersion: KNOWN.includes(asked) ? asked : KNOWN[0],
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'fake', version: '1.0.0' },
      })
    }
    case 'tools/list': {
      const from = Number(params.cursor ?? 0)
      const next = from + PAGE < tools.length ? String(from + PAGE) : undefined
      return reply({ tools: tools.slice(from, from + PAGE), ...(next ? { nextCursor: next } : {}) })
    }
    case 'tools/call':
      return reply(await called(params.name, params.arguments ?? {}, secret, changed))
    case 'ping':
      return reply({})
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${method}` } }
  }
}
const CHANGED = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' }
function stdio() {
  const said = (message) => process.stdout.write(JSON.stringify(message) + '\n')
  process.stderr.write('fake server ready\n')
  process.stdout.write('not json, a banner\n')
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return
    void answered(JSON.parse(line), process.env.FAKE_SECRET, () => {
      said(CHANGED)
    }).then((reply) => {
      if (reply) said(reply)
    })
  })
}
function body(request) {
  return new Promise((done) => {
    let all = ''
    request.on('data', (chunk) => (all += chunk))
    request.on('end', () => {
      done(all)
    })
  })
}
const event = (message, name) => `${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(message)}\n\n`
const sent = (response, status, value) => {
  const text = JSON.stringify(value)
  response
    .writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
    .end(text)
}
function authority(base) {
  const clients = new Map([['orden-preset', null]])
  const codes = new Map()
  const access = new Map()
  const refresh = new Set()
  const counts = { registered: 0, authorized: 0, refreshed: 0 }
  const lasts = Number(process.env.FAKE_EXPIRES ?? 3600)
  let next = 0
  const issue = () => {
    next += 1
    access.set(`access-${next}`, Date.now() + lasts * 1000)
    refresh.add(`refresh-${next}`)
    return { access_token: `access-${next}`, refresh_token: `refresh-${next}`, token_type: 'Bearer', expires_in: lasts }
  }
  return {
    allowed(request) {
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? ''
      return (access.get(token) ?? 0) > Date.now()
    },
    refuse(response) {
      response
        .writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${base()}/.well-known/oauth-protected-resource/mcp"`,
        })
        .end()
    },
    async handled(request, response, url) {
      const asked = url.searchParams
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /.well-known/oauth-protected-resource/mcp':
          sent(response, 200, { resource: `${base()}/mcp`, authorization_servers: [base()], scopes_supported: ['mcp'] })
          return true
        case 'GET /.well-known/oauth-authorization-server':
          sent(response, 200, {
            issuer: base(),
            authorization_endpoint: `${base()}/authorize`,
            token_endpoint: `${base()}/token`,
            registration_endpoint: `${base()}/register`,
            code_challenge_methods_supported: ['S256'],
          })
          return true
        case 'POST /register': {
          const wanted = JSON.parse(await body(request))
          counts.registered += 1
          const id = `client-${counts.registered}`
          clients.set(id, wanted.redirect_uris)
          sent(response, 201, {
            client_id: id,
            redirect_uris: wanted.redirect_uris,
            token_endpoint_auth_method: 'none',
          })
          return true
        }
        case 'GET /authorize': {
          const id = asked.get('client_id')
          const redirects = clients.get(id)
          const fits =
            redirects !== undefined &&
            (redirects === null || redirects.includes(asked.get('redirect_uri'))) &&
            asked.get('code_challenge_method') === 'S256' &&
            asked.get('resource') === `${base()}/mcp` &&
            asked.get('scope') === 'mcp'
          if (!fits) {
            sent(response, 400, { error: 'invalid_request' })
            return true
          }
          counts.authorized += 1
          const code = `code-${counts.authorized}`
          codes.set(code, { id, redirect: asked.get('redirect_uri'), challenge: asked.get('code_challenge') })
          const back = new URL(asked.get('redirect_uri'))
          back.searchParams.set('code', code)
          back.searchParams.set('state', asked.get('state'))
          response.writeHead(302, { location: back.toString() }).end()
          return true
        }
        case 'POST /token': {
          const form = new URLSearchParams(await body(request))
          if (form.get('resource') !== `${base()}/mcp`) {
            sent(response, 400, { error: 'invalid_target' })
            return true
          }
          if (form.get('grant_type') === 'authorization_code') {
            const kept = codes.get(form.get('code'))
            codes.delete(form.get('code'))
            const proved = createHash('sha256')
              .update(form.get('code_verifier') ?? '')
              .digest('base64url')
            const fits =
              kept &&
              kept.id === form.get('client_id') &&
              kept.redirect === form.get('redirect_uri') &&
              kept.challenge === proved
            sent(response, fits ? 200 : 400, fits ? issue() : { error: 'invalid_grant' })
            return true
          }
          if (!refresh.delete(form.get('refresh_token'))) {
            sent(response, 400, { error: 'invalid_grant' })
            return true
          }
          counts.refreshed += 1
          sent(response, 200, issue())
          return true
        }
        case 'POST /expire':
          access.clear()
          sent(response, 200, {})
          return true
        case 'POST /revoke':
          access.clear()
          refresh.clear()
          sent(response, 200, {})
          return true
        case 'GET /stats':
          sent(response, 200, counts)
          return true
        default:
          return false
      }
    },
  }
}
function streamable(port, sse, signed) {
  const sessions = new Map()
  const guard = signed ? authority(() => `http://127.0.0.1:${server.address().port}`) : null
  const changed = (session) => () => {
    const kept = sessions.get(session)
    if (!kept) return
    if (kept.listeners.size === 0) kept.missed = true
    for (const listener of kept.listeners) listener.write(event(CHANGED))
  }
  const server = createServer((request, response) => {
    void (async () => {
      if (guard && (await guard.handled(request, response, new URL(request.url, 'http://127.0.0.1')))) return
      if (guard && !guard.allowed(request)) return guard.refuse(response)
      const secret = request.headers['x-fake-secret']
      const session = request.headers['mcp-session-id']
      if (request.method === 'DELETE') {
        sessions.delete(session)
        response.writeHead(200).end()
        return
      }
      if (request.method === 'GET') {
        if (!sessions.has(session)) return response.writeHead(400).end()
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(': open\n\n')
        const kept = sessions.get(session)
        kept.listeners.add(response)
        if (kept.missed) response.write(event(CHANGED))
        kept.missed = false
        request.on('close', () => kept.listeners.delete(response))
        return
      }
      const message = JSON.parse(await body(request))
      const headers = {}
      if (message.method === 'initialize') {
        const made = `s${sessions.size + 1}`
        sessions.set(made, { listeners: new Set(), missed: false })
        headers['mcp-session-id'] = made
      } else if (!sessions.has(session)) {
        return response.writeHead(404).end()
      } else if (request.headers['mcp-protocol-version'] === undefined) {
        return response.writeHead(400).end('no protocol version')
      }
      const reply = await answered(message, secret, changed(session ?? headers['mcp-session-id']))
      if (!reply) return response.writeHead(202, headers).end()
      if (sse) {
        response.writeHead(200, { ...headers, 'content-type': 'text/event-stream' })
        response.end(event(reply, 'message'))
      } else {
        response.writeHead(200, { ...headers, 'content-type': 'application/json' })
        response.end(JSON.stringify(reply))
      }
    })()
  })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening ${server.address().port}\n`)
  })
}
function legacy(port) {
  const streams = new Map()
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/sse') {
        const session = `l${streams.size + 1}`
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(`event: endpoint\ndata: /messages?session=${session}\n\n`)
        streams.set(session, response)
        return
      }
      if (request.method === 'POST' && url.pathname === '/messages') {
        const stream = streams.get(url.searchParams.get('session'))
        if (!stream) return response.writeHead(404).end()
        const message = JSON.parse(await body(request))
        response.writeHead(202).end('Accepted')
        const reply = await answered(message, request.headers['x-fake-secret'], () => stream.write(event(CHANGED)))
        if (reply) stream.write(event(reply, 'message'))
        return
      }
      response.writeHead(405).end()
    })()
  })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening ${server.address().port}\n`)
  })
}
const [how, port = '0'] = process.argv.slice(2)
if (how === '--http') streamable(Number(port), false)
else if (how === '--http-sse') streamable(Number(port), true)
else if (how === '--oauth') streamable(Number(port), false, true)
else if (how === '--legacy') legacy(Number(port))
else stdio()
