/** Obeying a command before the reader has stopped saying it.
 *
 *  Emil, on even 0.5.7: *"right now it's extremely delayed ... it takes so long for a
 *  voice command that there's no reason to use it."* Most of that wait was the plugin
 *  being careful. A command is one or two words; the plugin held the microphone open
 *  through the silence after them in case a longer phrase was coming, then cut the
 *  utterance, then sent it, then waited for a model.
 *
 *  After "next" nothing longer can be coming - no phrase begins with it - so there is
 *  nothing to wait for. The speech so far is sent while the reader is still speaking,
 *  and a phrase the grammar calls settled is obeyed where it lands. This measures the
 *  two halves of that: which phrases are settled, and what the voice does with a look
 *  that comes back as one. */

import { describe, expect, test, vi } from 'vitest'
import { settled } from './commands'
import { type Ears, type Listening, Utterance, Voice } from './voice'

const FRAME = 640

function frame(level: number): Uint8Array {
  const pcm = new Uint8Array(FRAME)
  const view = new DataView(pcm.buffer)
  for (let at = 0; at < FRAME / 2; at++) {
    view.setInt16(at * 2, Math.round(level * 0x7fff * (at % 2 ? 1 : -1)), true)
  }

  return pcm
}

const SPEECH = frame(0.2)
const SILENCE = frame(0.001)

/* ── Which phrases are already the whole of a command ─────────────────── */

describe('a phrase that is settled', () => {
  test('is one nothing longer could begin with', () => {
    expect(settled('next')).toBe(true)
    expect(settled('back')).toBe(true)
    expect(settled('close')).toBe(true)
    expect(settled('spaces view')).toBe(true)
    expect(settled('voice commands off')).toBe(true)
  })

  /** The one that would have been a bug: a reader saying "switch space to work" says
   *  "switch space" on the way, and a plugin that jumped to the picker there would be
   *  worse than one that waited. */
  test('is not one that a longer phrase begins with', () => {
    expect(settled('switch space')).toBe(false)
    expect(settled('switch note')).toBe(false)
    expect(settled('voice')).toBe(false)
    expect(settled('go to')).toBe(false)
  })

  test('is not one that wants a name, a number or a question after it', () => {
    expect(settled('switch space to')).toBe(false)
    expect(settled('open page')).toBe(false)
    expect(settled('go to line')).toBe(false)
    expect(settled('question')).toBe(false)
  })

  test('is not half a word, and not a word with something after it', () => {
    expect(settled('')).toBe(false)
    expect(settled('nex')).toBe(false)
    expect(settled('next page')).toBe(false)
    expect(settled('the next thing to do')).toBe(false)
  })

  test('reads punctuation and capitals the way the matcher does', () => {
    expect(settled('Next.')).toBe(true)
    expect(settled('  CLOSE  ')).toBe(true)
  })

  /** A reader who rebinds a phrase rebinds this too, or the words they actually say
   *  would be the ones that wait. */
  test('follows the phrases this reader has', () => {
    expect(settled('weiter', { next: 'weiter' })).toBe(true)
    expect(settled('next', { next: 'weiter' })).toBe(false)

    // And a rebinding that makes one phrase the start of another is still caught:
    // nothing may be acted on early while a longer phrase begins with it.
    expect(settled('open', { next: 'open', page: 'open page' })).toBe(false)
  })
})

/* ── The look itself ──────────────────────────────────────────────────── */

describe('a look at half an utterance', () => {
  function ears(over: Partial<Ears> = {}): {
    ears: Ears
    heard: string[]
    failed: string[]
    states: Listening[]
    sent: number
  } {
    const heard: string[] = []
    const failed: string[] = []
    const states: Listening[] = []
    const box = { sent: 0 }

    return {
      heard,
      failed,
      states,
      get sent() {
        return box.sent
      },
      ears: {
        microphone: vi.fn(async () => true),
        canTranscribe: () => true,
        settled: (said) => settled(said),
        transcribe: vi.fn(async () => {
          box.sent++
          return 'next'
        }),
        heard: (one) => void heard.push(one.said),
        failed: (why) => void failed.push(why),
        said: (state) => void states.push(state),
        ...over,
      },
    }
  }

  /** Half a second of somebody talking, and no silence at all: the reader has not
   *  stopped, so nothing here is an utterance yet. */
  function speak(voice: Voice, frames = 25): void {
    for (let at = 0; at < frames; at++) voice.frame(SPEECH)
  }

  test('is taken while the reader is still talking, and obeyed at once', async () => {
    const one = ears()
    const voice = new Voice(one.ears)
    await voice.start()

    speak(voice)
    await vi.waitFor(() => expect(one.heard).toEqual(['next']))

    // Acted on with no silence measured at all: the reader is still talking.
    expect(one.failed).toEqual([])
    expect(one.sent).toBe(1)
  })

  test('and the rest of the phrase is then dropped rather than sent again', async () => {
    const one = ears()
    const voice = new Voice(one.ears)
    await voice.start()

    speak(voice)
    await vi.waitFor(() => expect(one.heard).toEqual(['next']))

    // The reader stops. What is left is the tail of a phrase already obeyed.
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await Promise.resolve()

    expect(one.heard).toEqual(['next'])
  })

  /** The other half of the rule: a look that is not a whole command changes nothing,
   *  and the utterance goes on being gathered. */
  test('is ignored where the words are not yet the whole of a command', async () => {
    const one = ears({ transcribe: vi.fn(async () => 'switch space') })
    const voice = new Voice(one.ears)
    await voice.start()

    speak(voice)
    await Promise.resolve()
    expect(one.heard).toEqual([])

    // And the whole of it is still sent when the reader stops.
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(one.heard).toEqual(['switch space']))
  })

  test('says nothing at all when it fails, because the utterance is still coming', async () => {
    let asked = 0
    const one = ears({
      transcribe: vi.fn(async () => {
        asked++
        if (asked === 1) throw new Error('a look that went nowhere')
        return 'next'
      }),
    })
    const voice = new Voice(one.ears)
    await voice.start()

    speak(voice)
    await vi.waitFor(() => expect(asked).toBe(1))
    expect(one.failed).toEqual([])

    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(one.heard).toEqual(['next']))
    expect(one.failed).toEqual([])
  })

  test('is not taken at all where nothing can say what is settled', async () => {
    const one = ears()
    // A plugin whose grammar cannot answer the question - which is what the shape of
    // `Ears` says is allowed - never looks early at all.
    const deaf: Ears = { ...one.ears }
    delete deaf.settled
    const voice = new Voice(deaf)
    await voice.start()

    speak(voice)
    await Promise.resolve()

    expect(one.sent).toBe(0)
    expect(one.heard).toEqual([])
  })

  test('says where the time went, for a phone nobody can read a log off', async () => {
    const one = ears()
    const voice = new Voice(one.ears)
    await voice.start()

    speak(voice)
    await vi.waitFor(() => expect(one.heard).toEqual(['next']))

    const took = voice.state.took
    expect(took).not.toBeNull()
    // No waiting for a silence: that is the whole of what this saves.
    expect(took?.hang).toBe(0)
    expect(took?.spoke).toBeGreaterThanOrEqual(400)
  })
})

/* ── How often a look may be taken ────────────────────────────────────── */

describe('an utterance being gathered', () => {
  test('is worth a look once there is enough of it to be worth one', () => {
    const utterance = new Utterance()
    let now = 0
    const feed = (pcm: Uint8Array) => {
      now += 20
      utterance.hear(pcm, now)
      return utterance.peek(now)
    }

    // Under four hundred milliseconds of speech: not yet.
    for (let at = 0; at < 19; at++) expect(feed(SPEECH)).toBeNull()
    expect(feed(SPEECH)).not.toBeNull()
  })

  test('is looked at twice at the most, and not twice in a row', () => {
    const utterance = new Utterance()
    let now = 0
    let looks = 0
    for (let at = 0; at < 200; at++) {
      now += 20
      utterance.hear(SPEECH, now)
      if (utterance.peek(now)) looks++
    }

    expect(looks).toBe(2)
  })

  test('and silence is never worth a look', () => {
    const utterance = new Utterance()
    let now = 0
    for (let at = 0; at < 100; at++) {
      now += 20
      utterance.hear(SILENCE, now)
      expect(utterance.peek(now)).toBeNull()
    }
  })

  test('starts again after one was acted on', () => {
    const utterance = new Utterance()
    let now = 0
    for (let at = 0; at < 25; at++) {
      now += 20
      utterance.hear(SPEECH, now)
    }

    expect(utterance.peek(now)).not.toBeNull()
    utterance.forget()
    expect(utterance.spoken).toBe(0)
    expect(utterance.peek(now)).toBeNull()
  })
})
