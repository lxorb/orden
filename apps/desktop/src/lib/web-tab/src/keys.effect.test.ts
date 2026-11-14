import { afterEach, expect, test } from 'vitest'
import { fromPage, replay } from './keys'

const listening: [string, EventListener, boolean][] = []

function hear(phase: string, capture: boolean, into: string[]) {
  const one: EventListener = (event) => {
    if (fromPage(event)) into.push(`${phase} ${event.eventPhase}`)
  }
  listening.push(['keydown', one, capture])
  window.addEventListener('keydown', one, capture)
}

afterEach(() => {
  for (const [type, one, capture] of listening.splice(0))
    window.removeEventListener(type, one, capture)
})

test('a key out of a page reaches the window’s capture listeners before its bubble ones, whichever came first', () => {
  const heard: string[] = []
  hear('bubble', false, heard)
  hear('capture', true, heard)

  replay({
    key: 'r',
    code: 'KeyR',
    ctrl: true,
    shift: false,
    alt: false,
    repeat: false,
    down: true,
  })

  expect(heard).toEqual([`capture ${Event.CAPTURING_PHASE}`, `bubble ${Event.BUBBLING_PHASE}`])
})

test('so a web tab’s own key, heard in capture, is taken before the app’s, heard after', () => {
  const steps: string[] = []
  const app: EventListener = (event) => {
    if (!event.defaultPrevented) steps.push('app reloads Orden')
  }
  const bar: EventListener = (event) => {
    event.preventDefault()
    steps.push('the bar reloads the page')
  }
  listening.push(['keydown', app, false], ['keydown', bar, true])
  window.addEventListener('keydown', app)
  window.addEventListener('keydown', bar, true)

  replay({
    key: 'r',
    code: 'KeyR',
    ctrl: true,
    shift: false,
    alt: false,
    repeat: false,
    down: true,
  })

  expect(steps).toEqual(['the bar reloads the page'])
})
