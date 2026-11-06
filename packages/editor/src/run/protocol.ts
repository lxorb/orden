import { frameDocument, literal } from '../web-frame'
import { formatRunValues } from './format'

type RunLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result' | 'exception'

export interface RunLine {
  level: RunLevel
  text: string
}

export interface RunMessage {
  run: number
  lines: RunLine[]
  ready: boolean
  done: boolean
}

const KIND = 'nib-run'

const LEVELS: readonly string[] = ['log', 'info', 'warn', 'error', 'debug', 'result', 'exception']

const MAX_LINE = 2_000

export function parseRunMessage(data: unknown, run: number): RunMessage | null {
  if (typeof data !== 'object' || data === null) return null

  const message = data as Record<string, unknown>
  if (message.nib !== KIND || message.run !== run) return null
  if (!Array.isArray(message.lines)) return null

  const lines: RunLine[] = []
  for (const entry of message.lines) {
    if (typeof entry !== 'object' || entry === null) return null
    const line = entry as Record<string, unknown>
    if (typeof line.text !== 'string') return null
    if (typeof line.level !== 'string' || !LEVELS.includes(line.level)) return null

    const text = line.text
    lines.push({
      level: line.level as RunLevel,
      text: text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text,
    })
  }

  return { run, lines, ready: message.ready === true, done: message.done === true }
}

export function runnerDocument(code: string, run: number, script: string): string {
  return frameDocument({
    head: `<meta http-equiv="Content-Security-Policy" content="${RUNNER_POLICY}">
<title>nib runner</title>`,
    program: runnerProgram(code, run),
    script,
  })
}

const RUNNER_POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; form-action 'none'"

function runnerProgram(code: string, run: number): string {
  return `(function () {
  var RUN = ${run}
  var CODE = ${literal(code)}
  var RUNNER = ${literal(WORKER)}

  function said(text) {
    parent.postMessage(
      { nib: '${KIND}', run: RUN, lines: [{ level: 'exception', text: text }], ready: true, done: true },
      '*',
    )
  }

  var worker
  try {
    worker = new Worker(URL.createObjectURL(new Blob([RUNNER], { type: 'text/javascript' })))
  } catch (error) {
    said(String(error))
    return
  }
  worker.onmessage = function (event) { parent.postMessage(event.data, '*') }
  worker.onerror = function (event) {
    event.preventDefault()
    said(event.message || 'the code could not be run')
  }
  worker.postMessage({ run: RUN, code: CODE })
})()`
}

const WORKER = `self.onmessage = function (event) {
  self.onmessage = null
  var RUN = event.data.run
  var CODE = event.data.code
  var format = ${String(formatRunValues)}

  var waiting = []
  var pending = false
  var finished = false

  function post(batch, ready, done) {
    self.postMessage(
      { nib: '${KIND}', run: RUN, lines: batch, ready: ready === true, done: done === true },
    )
  }

  // When output last went out. A worker's message leaves at once, whether or not the
  // code ever gives its thread back, so code that never does still shows what it said
  // on its way in - a tenth of a second at a time, not a message a line.
  var sentAt = -Infinity

  function send(done) {
    pending = false
    var batch = waiting
    waiting = []
    if (!batch.length && !done) return
    sentAt = performance.now()
    post(batch, false, done)
  }

  // Output goes out a task at a time. A loop that logs a thousand lines would
  // otherwise be a thousand messages, and a thousand editor transactions on the
  // other side. A channel rather than a timer, so that a window in the
  // background, where timers are throttled to once a minute, still shows its
  // output as it happens.
  var drain = new MessageChannel()
  drain.port1.onmessage = function () { send(false) }

  function add(level, text) {
    if (waiting.length > 600) return
    waiting.push({ level: level, text: text })
    if (performance.now() - sentAt >= 100) return send(false)
    if (pending) return
    pending = true
    drain.port2.postMessage(0)
  }

  function report(value) {
    add('exception', format([value], true))
  }

  var levels = ['log', 'info', 'warn', 'error', 'debug']
  for (var i = 0; i < levels.length; i++) {
    (function (level) {
      console[level] = function () {
        add(level, format(Array.prototype.slice.call(arguments)))
      }
    })(levels[i])
  }
  // Neighbours of log, so nothing a note writes is silently swallowed.
  console.dir = console.log
  console.trace = console.log

  // Neither of these flushes on the spot. \`add\` has already asked the channel
  // for a drain, and sending here as well would make one message - and so one
  // editor transaction - per error: a loop that rejects a promise each time is
  // exactly what the batching above is for.
  self.onerror = function (message, source, line, column, error) {
    if (error) report(error)
    else add('exception', String(message))
    return true
  }

  self.addEventListener('unhandledrejection', function (event) {
    event.preventDefault()
    report(event.reason)
  })

  function done(value, hasValue) {
    if (finished) return
    finished = true
    if (hasValue && value !== undefined) add('result', format([value], true))
    send(true)
  }

  function failed(error) {
    if (finished) return
    finished = true
    report(error)
    send(true)
  }

  var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

  // Top-level await is a syntax error in a script, so code that uses it has to
  // run as the body of an async function instead - which costs the value of the
  // last expression, since a function body only hands back what it returns.
  // Whether the code needs that is decided by compiling it, not by running it:
  // running it twice would run its side effects twice.
  function runAsync() {
    var body = null
    // A single expression, await and all, can still hand its value back.
    try {
      body = new AsyncFunction('return (' + CODE + '\\n)')
    } catch (error) {
      body = null
    }
    var hasValue = body !== null

    if (!body) {
      try {
        body = new AsyncFunction(CODE)
      } catch (error) {
        // Not valid either way: the code is simply broken, and this is the
        // message that says so.
        failed(error)
        return
      }
    }

    try {
      body().then(function (value) { done(value, hasValue) }, failed)
    } catch (error) {
      failed(error)
    }
  }

  function start() {
    var script = true
    try {
      new Function(CODE)
    } catch (error) {
      script = false
    }

    if (!script) return runAsync()

    try {
      // Indirect eval, so the code is a script: the last expression is its
      // value, the way it is in a console.
      done((0, eval)(CODE), true)
    } catch (error) {
      failed(error)
    }
  }

  // Said before the first line of the note's code runs, and the moment the time
  // limit starts counting: a frame and its worker can be seconds coming up on a
  // loaded machine, and coming up is not time the code asked for.
  //
  // The code then waits for the event loop to come round again, which is what
  // makes the word reliable. A message only leaves this frame when the task
  // that posted it ends, so code that never gives the task back - a plain
  // endless loop - would otherwise keep its own starting pistol in here, and be
  // stopped by the far longer deadline meant for a frame that never came up. A
  // channel rather than a timer, because a hidden page's timers are throttled
  // to once a minute and messages are not.
  var gate = new MessageChannel()
  gate.port1.onmessage = start
  post([], true, false)
  gate.port2.postMessage(0)
}`
