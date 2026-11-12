import { describe, expect, test } from 'vitest'
import { askMachine, eraseMachines } from '../src/machines/ask'
import { isMachineHost, machineDomain } from '../src/machines/hetzner-host'

type Env = Parameters<typeof askMachine>[0]

function fakeMachines(
  answer: (request: Request, id: string) => Response | Error,
  options: { jurisdiction?: boolean; dev?: boolean } = {},
): { env: Env; asked: Request[]; places: string[] } {
  const asked: Request[] = []
  const places: string[] = []
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: (request: Request) => {
        asked.push(request)
        const got = answer(request, id)
        return got instanceof Error ? Promise.reject(got) : Promise.resolve(got)
      },
    }),
    ...(options.jurisdiction
      ? {
          jurisdiction(place: string) {
            places.push(place)
            return namespace
          },
        }
      : {}),
  }
  const env = {
    MACHINES: namespace,
    ...(options.dev ? { MACHINE_DEV_ORDEND: 'http://localhost:1' } : {}),
  } as unknown as Env
  return { env, asked, places }
}

describe('asking a machine', () => {
  test('names the ask and the machine in headers and keeps the machine in the EU', async () => {
    const { env, asked, places } = fakeMachines(() => new Response('ok'), { jurisdiction: true })
    const answer = await askMachine(env, 'm-1', 'state', { 'x-orden-user': 'u' })
    expect(answer?.ok).toBe(true)
    expect(places).toEqual(['eu'])
    expect(asked[0]?.headers.get('x-orden-machine')).toBe('state')
    expect(asked[0]?.headers.get('x-orden-id')).toBe('m-1')
    expect(asked[0]?.headers.get('x-orden-user')).toBe('u')
  })

  test('a development machine host is not pinned to a jurisdiction', async () => {
    const { env, places } = fakeMachines(() => new Response('ok'), {
      jurisdiction: true,
      dev: true,
    })
    await askMachine(env, 'm-1', 'state')
    expect(places).toEqual([])
  })

  test('asks once more after a reset object, and answers null without a namespace', async () => {
    let calls = 0
    const { env } = fakeMachines(() => {
      calls += 1
      return calls === 1 ? new Error('reset') : new Response('ok')
    })
    expect((await askMachine(env, 'm-1', 'start'))?.ok).toBe(true)
    expect(await askMachine({} as unknown as Env, 'm-1', 'start')).toBeNull()
  })

  test('erasing reports only the machines that acknowledged, and all of them without a namespace', async () => {
    const { env } = fakeMachines((_request, id) =>
      id === 'm-2' ? new Response('busy', { status: 409 }) : new Response('ok'),
    )
    expect(await eraseMachines(env, ['m-1', 'm-2', 'm-3'])).toEqual(['m-1', 'm-3'])
    expect(await eraseMachines({} as unknown as Env, ['m-1'])).toEqual(['m-1'])
  })
})

describe('machine hosts', () => {
  test('a machine host is one label under the machine domain', () => {
    expect(machineDomain({ MACHINE_DOMAIN: 'machines.example' } as unknown as Env)).toBe(
      'machines.example',
    )
    const id = 'a'.repeat(32)
    expect(isMachineHost(`m-${id}.machines.example`, 'machines.example')).toBe(true)
    expect(isMachineHost(`M-${id}.Machines.Example`, 'machines.example')).toBe(true)
    expect(isMachineHost('machines.example', 'machines.example')).toBe(false)
    expect(isMachineHost(`m-${id}.other.example`, 'machines.example')).toBe(false)
    expect(isMachineHost(`x-${id}.machines.example`, 'machines.example')).toBe(false)
  })
})
