import { spawn } from 'node:child_process'
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
function streamable(port, sse) {
  const sessions = new Map()
  const changed = (session) => () => {
    const kept = sessions.get(session)
    if (!kept) return
    if (kept.listeners.size === 0) kept.missed = true
    for (const listener of kept.listeners) listener.write(event(CHANGED))
  }
  const server = createServer((request, response) => {
    void (async () => {
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
else if (how === '--legacy') legacy(Number(port))
else stdio()
