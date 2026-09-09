import { describe, expect, test, vi } from 'vitest'
import { type Ears, loudnessOf, Utterance, Voice, wavOf } from './voice'

/** Twenty milliseconds of sound at 16 kHz, sixteen bit: 320 samples, 640 bytes.
 *  The frame size the glasses' audio path sends. */
const FRAME = 640

function frame(loudness: number): Uint8Array {
  const pcm = new Uint8Array(FRAME)
  const view = new DataView(pcm.buffer)
  for (let at = 0; at < FRAME / 2; at++) {
    // A square wave, so that every sample is at the amplitude asked for and the
    // root mean square of the frame is exactly it.
    view.setInt16(at * 2, Math.round(loudness * 0x7fff) * (at % 2 ? 1 : -1), true)
  }

  return pcm
}

const SPEECH = frame(0.2)
const SILENCE = frame(0.001)

/** Where a phrase begins and ends, which is the one number the plugin itself adds
 *  to the latency of a spoken command. */
describe('cutting an utterance out of the stream', () => {
  test('says nothing while nobody is talking', () => {
    const utterance = new Utterance()

    for (let at = 0; at < 200; at++) {
      expect(utterance.hear(SILENCE, at * 20)).toBeNull()
    }
  })

  test('says nothing while somebody is still talking', () => {
    const utterance = new Utterance()

    for (let at = 0; at < 50; at++) {
      expect(utterance.hear(SPEECH, at * 20)).toBeNull()
    }
  })

  test('answers with the utterance after six hundred milliseconds of quiet', () => {
    const utterance = new Utterance()
    let now = 0
    const feed = (pcm: Uint8Array) => {
      now += 20
      return utterance.hear(pcm, now)
    }

    // Half a second of speech.
    for (let at = 0; at < 25; at++) expect(feed(SPEECH)).toBeNull()
    // Then quiet. Nothing until the pause is long enough to be the end.
    for (let at = 0; at < 29; at++) expect(feed(SILENCE)).toBeNull()

    const whole = feed(SILENCE)
    expect(whole).not.toBeNull()
    // The speech and the silence after it, which is what was heard.
    expect(whole?.pcm.length).toBe(FRAME * 55)
  })

  test('says the speech ended where the silence began, not where it was noticed', () => {
    const utterance = new Utterance()
    let now = 0
    const feed = (pcm: Uint8Array) => {
      now += 20
      return utterance.hear(pcm, now)
    }

    for (let at = 0; at < 25; at++) feed(SPEECH)
    const stopped = now
    let whole = null
    while (!whole) whole = feed(SILENCE)

    // This is what a latency has to be measured from: the moment the reader stopped
    // talking, and not the moment six hundred milliseconds later when the pause
    // became long enough to act on.
    expect(whole.ended).toBeCloseTo(stopped, -1)
    expect(now - whole.ended).toBeGreaterThanOrEqual(600)
  })

  test('throws away a noise too short to be a word', () => {
    const utterance = new Utterance()
    let now = 0
    const feed = (pcm: Uint8Array) => {
      now += 20
      return utterance.hear(pcm, now)
    }

    // A tenth of a second: a door, a cough, a knuckle on a temple.
    for (let at = 0; at < 5; at++) feed(SPEECH)
    for (let at = 0; at < 40; at++) expect(feed(SILENCE)).toBeNull()
  })

  test('sends a reader who keeps talking after eight seconds anyway', () => {
    const utterance = new Utterance()
    let now = 0
    let whole = null
    for (let at = 0; at < 500 && !whole; at++) {
      now += 20
      whole = utterance.hear(SPEECH, now)
    }

    expect(whole).not.toBeNull()
    expect(now).toBeGreaterThanOrEqual(8000)
    expect(now).toBeLessThan(8400)
  })

  test('hears a second phrase after the first', () => {
    const utterance = new Utterance()
    let now = 0
    const feed = (pcm: Uint8Array) => {
      now += 20
      return utterance.hear(pcm, now)
    }
    const phrase = () => {
      for (let at = 0; at < 25; at++) feed(SPEECH)
      let whole = null
      while (!whole) whole = feed(SILENCE)
      return whole
    }

    const first = phrase()
    const second = phrase()

    expect(first.pcm.length).toBe(second.pcm.length)
    expect(second.ended).toBeGreaterThan(first.ended)
  })

  test('starts the phrase at the first loud frame, not at the silence before it', () => {
    const utterance = new Utterance()
    let now = 0
    const feed = (pcm: Uint8Array) => {
      now += 20
      return utterance.hear(pcm, now)
    }

    // Two seconds of a quiet room first.
    for (let at = 0; at < 100; at++) feed(SILENCE)
    for (let at = 0; at < 25; at++) feed(SPEECH)
    let whole = null
    while (!whole) whole = feed(SILENCE)

    // The phrase and its trailing pause, and none of the two seconds before it.
    expect(whole.pcm.length).toBe(FRAME * 55)
  })
})

describe('how loud a frame is', () => {
  test('measures the root mean square, from zero to one', () => {
    expect(loudnessOf(frame(0))).toBeCloseTo(0, 3)
    expect(loudnessOf(frame(0.2))).toBeCloseTo(0.2, 2)
    expect(loudnessOf(frame(1))).toBeCloseTo(1, 2)
  })

  test('answers zero for no sound at all', () => {
    expect(loudnessOf(new Uint8Array(0))).toBe(0)
  })
})

describe('the file a transcriber is sent', () => {
  test('is a wav, with the samples that arrived and nothing re-encoded', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const wav = wavOf(pcm)

    expect(wav.length).toBe(44 + pcm.length)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...wav.slice(36, 40))).toBe('data')
    expect([...wav.slice(44)]).toEqual([...pcm])
  })

  test('says one channel of sixteen bit at 16 kHz, which is what the glasses send', () => {
    const view = new DataView(wavOf(new Uint8Array(4)).buffer)

    expect(view.getUint16(20, true)).toBe(1) // uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1) // one channel
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16) // bits a sample
    expect(view.getUint32(28, true)).toBe(32_000) // bytes a second
  })
})

/** Which of the two paths a device has, and what it does with the one it has. */
describe('listening', () => {
  function ears(over: Partial<Ears> = {}): { ears: Ears; heard: string[]; failed: string[] } {
    const heard: string[] = []
    const failed: string[] = []
    return {
      heard,
      failed,
      ears: {
        microphone: vi.fn(async () => true),
        transcribe: vi.fn(async () => 'next'),
        heard: (one) => void heard.push(one.said),
        failed: (why) => void failed.push(why),
        ...over,
      },
    }
  }

  test('opens the glasses microphone where the WebView has no recogniser', async () => {
    const { ears: one } = ears()
    const voice = new Voice(one)

    expect(voice.path).toBe('glasses')
    expect(await voice.start()).toBe(true)
    expect(one.microphone).toHaveBeenCalledWith(true)
    expect(voice.listening).toBe(true)
  })

  test('closes it again when asked to stop', async () => {
    const { ears: one } = ears()
    const voice = new Voice(one)
    await voice.start()

    await voice.stop()

    expect(one.microphone).toHaveBeenLastCalledWith(false)
    expect(voice.listening).toBe(false)
  })

  test('says so rather than listening deaf when there is no way to recognise', async () => {
    const { ears: one, failed } = ears({ transcribe: null })
    const voice = new Voice(one)

    expect(voice.path).toBe('none')
    expect(await voice.start()).toBe(false)
    expect(failed).toEqual(['no recognition'])
    expect(one.microphone).not.toHaveBeenCalled()
  })

  test('says so when the host would not open the microphone', async () => {
    const { ears: one, failed } = ears({ microphone: vi.fn(async () => false) })
    const voice = new Voice(one)

    expect(await voice.start()).toBe(false)
    expect(failed).toEqual(['no microphone'])
  })

  test('transcribes a phrase out of the frames and hands over the words', async () => {
    const { ears: one, heard } = ears()
    const voice = new Voice(one)
    await voice.start()

    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(heard).toEqual(['next']))

    expect(one.transcribe).toHaveBeenCalledTimes(1)
    // A wav, header and all.
    const sent = vi.mocked(one.transcribe as (wav: Uint8Array) => Promise<string | null>).mock
      .calls[0]?.[0]
    expect(String.fromCharCode(...(sent?.slice(0, 4) ?? []))).toBe('RIFF')
  })

  test('ignores frames before it was asked to listen', () => {
    const { ears: one } = ears()
    const voice = new Voice(one)

    for (let at = 0; at < 60; at++) voice.frame(SPEECH)

    expect(one.transcribe).not.toHaveBeenCalled()
  })

  test('says what went wrong when a transcription failed', async () => {
    const { ears: one, failed } = ears({
      transcribe: vi.fn(async () => {
        throw new Error('no signal')
      }),
    })
    const voice = new Voice(one)
    await voice.start()

    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(failed).toEqual(['no signal']))
  })

  test('says nothing when the transcriber heard nothing', async () => {
    const { ears: one, heard } = ears({ transcribe: vi.fn(async () => null) })
    const voice = new Voice(one)
    await voice.start()

    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(one.transcribe).toHaveBeenCalled())

    expect(heard).toEqual([])
  })
})
