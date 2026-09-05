import { formatRunValues } from './format'

/** What kind of line the panel is showing. The five console levels, the value
 *  of the last expression, and anything that was thrown or rejected. */
export type RunLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result' | 'exception'

export interface RunLine {
  level: RunLevel
  text: string
}

/** One batch of output on its way out of the sandbox. `ready` is the first
 *  message, sent the moment before the code starts. `done` says the code has
 *  finished; lines can still follow, because a timer or a rejected promise the
 *  code left behind arrives after it. */
export interface RunMessage {
  run: number
  lines: RunLine[]
  ready: boolean
  done: boolean
}

/** Marks the messages as ours. The sandbox has an opaque origin, so `postMessage`
 *  can only be aimed at `*` and anything on the page could be shouting; the
 *  parent also checks that the message came from the frame it made (see run.ts),
 *  which is the check that actually matters. */
const KIND = 'nib-run'

const LEVELS: readonly string[] = ['log', 'info', 'warn', 'error', 'debug', 'result', 'exception']

/** Reads a message from the sandbox, or nothing if it is not one of ours, not
 *  the shape we send, or belongs to a run that has been replaced. */
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
    lines.push({ level: line.level as RunLevel, text: line.text })
  }

  return { run, lines, ready: message.ready === true, done: message.done === true }
}

/** The code, as a JavaScript string literal the HTML parser cannot escape from.
 *  JSON covers quotes, backslashes and newlines; `<` is what JSON leaves alone
 *  and what would end the script element early, so it goes out as an escape
 *  that means the same thing inside a string literal. */
function literal(code: string): string {
  return JSON.stringify(code).replace(/</g, '\\u003c')
}

/** The document the sandbox runs.
 *
 *  Two things keep it harmless, and they are independent of each other. The
 *  frame is sandboxed without `allow-same-origin`, so the document has an
 *  opaque origin: the app's DOM, storage, IndexedDB, cookies and notes are all
 *  cross-origin to it and reading them throws. And this policy leaves it
 *  nothing to talk to: `default-src 'none'` covers fetch, XHR, WebSocket,
 *  EventSource, imports, images, nested frames and workers, so the code cannot
 *  reach the network or spawn anything that outlives the frame.
 *
 *  `'unsafe-eval'` is the one concession, and it is what makes the feature
 *  possible at all: the value of the last expression only exists if the code is
 *  evaluated rather than parsed as part of this document. It hands the code
 *  nothing extra, since the code is already inline and there is nothing left
 *  for it to load. */
export function runnerDocument(code: string, run: number): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">
<title>nib runner</title>
<script>
(function () {
  var RUN = ${run}
  var CODE = ${literal(code)}
  var format = ${String(formatRunValues)}

  var waiting = []
  var pending = false
  var finished = false

  function post(batch, ready, done) {
    parent.postMessage(
      { nib: '${KIND}', run: RUN, lines: batch, ready: ready === true, done: done === true },
      '*',
    )
  }

  function send(done) {
    pending = false
    var batch = waiting
    waiting = []
    if (!batch.length && !done) return
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

  window.onerror = function (message, source, line, column, error) {
    if (error) report(error)
    else add('exception', String(message))
    send(false)
    return true
  }

  window.addEventListener('unhandledrejection', function (event) {
    event.preventDefault()
    report(event.reason)
    send(false)
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
  // limit starts counting: a sandboxed frame is a browser process of its own,
  // and coming up is not time the code asked for.
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
})()
</script>
`
}
