import { execSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { bytes, healthy, linked, until, type Link } from './link'

const URL = process.env.NIBD_SURVIVE_URL ?? ''
const SECRET = process.env.NIBD_SECRET ?? ''
const RESTARTS = (JSON.parse(process.env.NIBD_SURVIVE_RESTARTS ?? '[]') as unknown[]).filter(
  (one): one is string => typeof one === 'string',
)
const SESSION = 's_survive'

const ticks = (seen: string) => [...seen.matchAll(/tick-(\d+)/g)].map((match) => Number(match[1]))

async function joined(): Promise<Link> {
  await healthy(URL)
  const link = await linked(URL, SECRET)
  link.send({ t: 'open', session: SESSION, cols: 120, rows: 40 })
  link.send({ t: 'want', session: SESSION, since: 0 })
  return link
}

describe.runIf(URL)('a program on the machine', () => {
  test('goes on through every restart of nibd', async () => {
    let link = await joined()
    link.send({
      t: 'in',
      session: SESSION,
      data: bytes(
        'cat /proc/$PPID/cgroup; echo holder-kb=$(ps -o rss= -p $PPID); n=0; while :; do n=$((n+1)); echo tick-$n; sleep 0.5; done\r',
      ),
    })
    await until(() => ticks(link.text(SESSION)).length >= 3, 120_000)
    if (process.env.NIBD_SURVIVE_CGROUP) expect(link.text(SESSION)).toContain(`/nibd/${SESSION}`)
    console.log(/holder-kb=\s*\d+/.exec(link.text(SESSION))?.[0])

    for (const restart of ['the link', ...RESTARTS]) {
      const before = ticks(link.text(SESSION)).at(-1) ?? 0
      if (restart === 'the link') link.send({ t: 'restart' })
      else execSync(restart, { stdio: 'inherit' })
      link.close()
      await new Promise((resolve) => setTimeout(resolve, 3000))
      link = await joined()
      await until(() => link.frames.some((frame) => frame.t === 'screen'), 60_000)
      const screen = link.frames.find((frame) => frame.t === 'screen')
      expect(screen?.t === 'screen' && screen.restored).toBeFalsy()
      await until(() => (ticks(link.text(SESSION)).at(-1) ?? 0) > before + 2, 60_000)
      console.log(`${restart}: still counting, ${String(before)} before`)
    }

    link.send({ t: 'in', session: SESSION, data: bytes('\x03') })
    link.send({ t: 'close', session: SESSION })
    link.close()
  })
})
