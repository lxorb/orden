import { frameDocument, literal } from '../web-frame'
import { formatRunValues } from './format'

/** What kind of line the panel is showing. The five console levels, the value
 *  of the last expression, and anything that was thrown or rejected. */
type RunLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result' | 'exception'

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

/** The longest line the panel will keep.
 *
 *  The sandbox clips each *value* it describes, but one call can carry ten
 *  thousand of them, and a message the frame builds by hand goes through no
 *  formatter at all. `MAX_RUN_LINES` caps how many lines are kept, not how big
 *  one is, so without this a note could put megabytes into the editor's state
 *  and keep them there. Clipped on this side because this is the side that has
 *  to hold it. */
const MAX_LINE = 2_000

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

    const text = line.text
    lines.push({
      level: line.level as RunLevel,
      text: text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text,
    })
  }

  return { run, lines, ready: message.ready === true, done: message.done === true }
}

/** The document the sandbox runs.
 *
 *  Two things keep it harmless, and they are independent of each other. The
 *  frame is sandboxed without `allow-same-origin`, so the document has an
 *  opaque origin: the app's DOM, storage, IndexedDB, cookies and notes are all
 *  cross-origin to it and reading them throws. And this policy takes away nearly
 *  everything it could talk to: `default-src 'none'` covers fetch, XHR,
 *  WebSocket, EventSource, imports, images, nested frames and workers, and
 *  `form-action 'none'` is said out loud because forms do not fall back to it.
 *
 *  The one thing neither layer stops is the frame navigating *itself*: setting
 *  its own `location` is a request that leaves the machine, carrying whatever the
 *  code put in the URL. Nothing comes back - the frame is gone and its listener
 *  with it - and the reader asked for this code to run, so it is named here
 *  rather than claimed to be closed.
 *
 *  `'unsafe-eval'` is the other concession, and it is what makes the feature
 *  possible at all: the value of the last expression only exists if the code is
 *  evaluated rather than parsed as part of this document. It hands the code
 *  nothing extra: the one script the document runs is the frame script, which is
 *  what evaluates the runner below, and the runner is text in the document rather
 *  than a script of it - the app's policy, which a `srcdoc` frame inherits, runs
 *  no inline script but that one. See frame-script.js. */
export function runnerDocument(code: string, run: number, script: string): string {
  return frameDocument({
    head: `<meta http-equiv="Content-Security-Policy" content="${RUNNER_POLICY}">
<title>nib runner</title>`,
    program: runnerProgram(code, run),
    script,
  })
}

/** The runner's own policy, on top of the app's, which the document inherits.
 *
 *  This one is about the network: `default-src 'none'` takes it all away. Which
 *  inline script may run is the app's policy's to say - the frame script, by its
 *  hash, and nothing else - and a script has to pass both, so the
 *  `'unsafe-inline'` here widens nothing; it only keeps this line from having to
 *  know the hash as well. */
const RUNNER_POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; form-action 'none'"

/** What the sandbox runs, as the text the frame script evaluates: not the note's code
 *  itself, but a worker that runs it (#525).
 *
 *  A frame is no process of its own in WebKit - a Mac, an iPhone, Safari - and code that
 *  never gives its task back took the app's own thread with it, the timer that was to
 *  take the frame down included, for good. A worker is a thread of its own in every
 *  engine, so the frame and the app around it go on whatever the code does, and the
 *  frame going takes its worker with it: the time limit in run.ts is again the way a
 *  run is stopped. The worker is made from the frame's own opaque origin, so it reaches
 *  no more than the frame did, under the same two policies; `worker-src blob:` in
 *  `RUNNER_POLICY` is what lets the frame make it. What the code no longer has is a
 *  document, which it never had any use for: its output is the panel. */
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

/** The worker the code runs in, told its run and its code by the one message the frame
 *  sends it. */
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
