import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('../../../src-tauri/src/web_opens.rs', import.meta.url), 'utf8')
const script = /pub const PAGE_SCRIPT: &str = r"([\s\S]*?)";/.exec(source)?.[1] ?? ''

type Inside = Window &
  typeof globalThis & {
    showOpenFilePicker: () => Promise<unknown>
  }

function page(ours = true) {
  const dom = new JSDOM(
    '<input id="file" type="file"><input id="text"><label id="label" for="file">a file</label>',
    {
      runScripts: 'outside-only',
    },
  )
  const inside = dom.window as unknown as Inside
  const reached: string[] = []
  let now = 1_000_000
  inside.Date.now = () => now

  const reach = (name: string, answer?: unknown) =>
    function () {
      reached.push(name)
      return answer
    }
  Object.defineProperty(inside.Element.prototype, 'requestFullscreen', {
    value: reach('fullscreen', Promise.resolve()),
    configurable: true,
    writable: true,
  })
  const Clipboards = class {
    readonly made = 'clipboard'
  }
  Object.defineProperty(inside, 'Clipboard', {
    value: Clipboards,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(Clipboards.prototype, 'writeText', {
    value: reach('writeText', Promise.resolve()),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(inside.Document.prototype, 'execCommand', {
    value(command: string) {
      reached.push(`execCommand ${command}`)
      return true
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(inside.HTMLElement.prototype, 'click', {
    value(this: HTMLElement) {
      reached.push(`click ${this.id}`)
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(inside.HTMLInputElement.prototype, 'showPicker', {
    value: reach('showPicker'),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(inside, 'showOpenFilePicker', {
    value: reach('showOpenFilePicker', Promise.resolve([])),
    configurable: true,
    writable: true,
  })
  const Payments = class {
    readonly made = 'payment'
  }
  Object.defineProperty(inside, 'PaymentRequest', {
    value: Payments,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(Payments.prototype, 'show', {
    value: reach('payment', Promise.resolve()),
    configurable: true,
    writable: true,
  })
  Object.defineProperty(inside, 'Notification', {
    value: {
      permission: 'default',
      requestPermission: reach('notifications', Promise.resolve('granted')),
    },
    configurable: true,
    writable: true,
  })
  inside.open = reach('open', null) as typeof inside.open

  const ran = ours ? script : script.replace('var ours = true', 'var ours = false')
  inside.eval(ran.replaceAll('event.isTrusted', 'event.cancelable'))

  const document = inside.document
  const commands = document as unknown as { execCommand: (name: string) => boolean }
  const file = document.getElementById('file') as HTMLInputElement
  const label = document.getElementById('label') as HTMLLabelElement
  const text = document.getElementById('text') as HTMLInputElement
  const clipboard = new Clipboards() as unknown as Clipboard
  const asked = {
    fullscreen: () => document.body.requestFullscreen(),
    writeText: () => clipboard.writeText('words'),
    copy: () => commands.execCommand('copy'),
    file: () => file.click(),
    label: () => label.click(),
    showPicker: () => text.showPicker(),
    filePicker: () => inside.showOpenFilePicker(),
    payment: () => (new Payments() as unknown as PaymentRequest).show(),
    notifications: () => inside.Notification.requestPermission(),
    open: () => inside.open('https://elsewhere.example/'),
  }
  const pressed = (cancelable = true) =>
    document.body.dispatchEvent(new inside.MouseEvent('mousedown', { bubbles: true, cancelable }))
  const later = (ms: number) => {
    now += ms
  }
  const everything = () => {
    const answers: Record<string, unknown> = {}
    for (const [name, ask] of Object.entries(asked)) {
      try {
        const answer = ask()
        if (answer instanceof inside.Promise || answer instanceof Promise)
          answer.catch(() => undefined)
        answers[name] = answer
      } catch (error) {
        answers[name] = error
      }
    }
    return answers
  }
  return { inside, reached, asked, commands, pressed, later, everything }
}

function thrown(ask: () => unknown) {
  try {
    ask()
  } catch (error) {
    return error
  }
  return null
}

describe('a web page with no press of the reader', () => {
  test('never reaches fullscreen, the clipboard, a file picker, a payment, a prompt or a window', () => {
    const { reached, everything } = page()
    everything()
    expect(reached).toEqual([])
  })

  test('is refused the way the engine refuses a page that was never pressed', async () => {
    const { asked, commands } = page()
    await expect(asked.fullscreen()).rejects.toThrow('Permissions check failed')
    await expect(asked.writeText()).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(asked.copy()).toBe(false)
    expect(thrown(asked.showPicker)).toMatchObject({ name: 'NotAllowedError' })
    await expect(asked.filePicker()).rejects.toMatchObject({ name: 'SecurityError' })
    await expect(asked.payment()).rejects.toMatchObject({ name: 'SecurityError' })
    await expect(asked.notifications()).resolves.toBe('default')
    expect(asked.open()).toBeNull()
    expect(commands.execCommand('bold')).toBe(true)
  })

  test('still clicks what is not a file field', () => {
    const { inside, reached } = page()
    inside.document.getElementById('text')?.click()
    expect(reached).toEqual(['click text'])
  })

  test('is not pressed by an event the page made itself', () => {
    const { reached, pressed, everything } = page()
    pressed(false)
    everything()
    expect(reached).toEqual([])
  })
})

describe('a press of the reader', () => {
  test('lets each kind through once, one picker of all the pickers', () => {
    const { reached, pressed, everything } = page()
    pressed()
    everything()
    expect(reached).toEqual([
      'fullscreen',
      'writeText',
      'execCommand copy',
      'click file',
      'payment',
      'notifications',
      'open',
    ])
    reached.length = 0
    everything()
    expect(reached).toEqual([])
  })

  test('is spent after five seconds', () => {
    const { reached, pressed, later, asked } = page()
    pressed()
    later(5_000)
    asked.fullscreen().catch(() => undefined)
    asked.writeText().catch(() => undefined)
    expect(reached).toEqual([])
    pressed()
    later(4_000)
    void asked.fullscreen()
    expect(reached).toEqual(['fullscreen'])
  })

  test('opens a file field through its label', () => {
    const { reached, pressed, asked } = page()
    asked.label()
    expect(reached).toEqual([])
    pressed()
    asked.label()
    expect(reached).toEqual(['click label'])
  })

  test('lets the clipboard through after the engine spent its own activation, but never a window', () => {
    const { inside, reached, pressed, asked } = page()
    Object.defineProperty(inside.navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true,
    })
    pressed()
    void asked.writeText()
    asked.open()
    expect(reached).toEqual(['writeText'])
  })

  test('leaves a window without an opener to the engine where the engine makes it a tab', () => {
    const own = page(true)
    own.pressed()
    expect(own.inside.open('https://elsewhere.example/', '_blank', 'noopener')).toBeNull()
    expect(own.reached).toEqual([])
    const engine = page(false)
    engine.pressed()
    engine.inside.open('https://elsewhere.example/', '_blank', 'noopener')
    expect(engine.reached).toEqual(['open'])
  })
})
