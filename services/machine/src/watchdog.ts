import { Worker } from 'node:worker_threads'

export const STALL = 60_000
const BEAT = 1000

export function stalled(last: number, now: number, limit = STALL): boolean {
  return now - last > limit
}

const WORKER = `
const { workerData } = require('node:worker_threads')
const { writeSync } = require('node:fs')
const slot = new BigInt64Array(workerData.slot)
setInterval(() => {
  const late = Date.now() - Number(Atomics.load(slot, 0))
  if (late <= workerData.limit) return
  try { writeSync(2, 'ordend: the event loop has not turned for ' + late + ' ms; ending\\n') } catch {}
  process.kill(process.pid, 'SIGKILL')
}, workerData.beat)
`

export function watch(limit = STALL, beat = BEAT): () => void {
  const shared = new SharedArrayBuffer(8)
  const slot = new BigInt64Array(shared)
  const now = () => {
    Atomics.store(slot, 0, BigInt(Date.now()))
  }
  now()
  const worker = new Worker(WORKER, {
    eval: true,
    execArgv: [],
    workerData: { slot: shared, limit, beat },
  })
  worker.unref()
  const timer = setInterval(now, beat)
  timer.unref()
  return () => {
    clearInterval(timer)
    void worker.terminate()
  }
}
