import { afterEach, describe, expect, test, vi } from 'vitest'
import { type Ears, type Listening, loudnessOf, Utterance, Voice, wavOf } from './voice'

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
  function ears(over: Partial<Ears> = {}): {
    ears: Ears
    heard: string[]
    failed: string[]
    states: Listening[]
  } {
    const heard: string[] = []
    const failed: string[] = []
    const states: Listening[] = []
    return {
      heard,
      failed,
      states,
      ears: {
        microphone: vi.fn(async () => true),
        canTranscribe: () => true,
        transcribe: vi.fn(async () => 'next'),
        heard: (one) => void heard.push(one.said),
        failed: (why) => void failed.push(why),
        said: (state) => void states.push(state),
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

  /** Emil's account had no key at all, and the plugin answered "no way to listen".
   *  It was telling the truth and it was the wrong thing to say: the glasses have a
   *  microphone either way, so it opens either way, and what is missing is one line
   *  in Settings rather than anything about the device. */
  test('opens the microphone even with no key, and says what is missing', async () => {
    const { ears: one, failed } = ears({ canTranscribe: () => false })
    const voice = new Voice(one)

    expect(voice.path).toBe('glasses')
    expect(await voice.start()).toBe(true)
    expect(one.microphone).toHaveBeenCalledWith(true)
    expect(failed).toEqual(['voice needs an OpenAI key'])
  })

  test('and says it again when something was said, rather than sending it nowhere', async () => {
    const { ears: one, failed } = ears({ canTranscribe: () => false })
    const voice = new Voice(one)
    await voice.start()

    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)

    expect(one.transcribe).not.toHaveBeenCalled()
    expect(failed).toEqual(['voice needs an OpenAI key', 'voice needs an OpenAI key'])
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
    await vi.waitFor(() => expect(failed).toEqual(['the words did not come back']))
    // The platform's own words beside ours, so the phone says which fault it was.
    expect(voice.state.detail).toBe('no signal')
  })

  test('says nothing when the transcriber heard nothing', async () => {
    const { ears: one, heard } = ears({ transcribe: vi.fn(async () => null) })
    const voice = new Voice(one)
    await voice.start()

    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(one.transcribe).toHaveBeenCalled())

    expect(heard).toEqual([])
    // Sent, and nothing came back. A different fault from one that never went, and
    // the phone says which; see the readout in Glasses.svelte.
    await vi.waitFor(() => expect(voice.state.nothing).toBe(true))
  })
})

/* ── When the phone's own recogniser is not a recogniser ──────────────── */

/** Chromium's `webkitSpeechRecognition`, as an embedded WebView has it: the
 *  constructor is there, `start()` is perfectly happy, and a moment later it says
 *  it cannot reach the service that does the recognising. That is the shape of
 *  Emil's "voice mode simply doesn't work whatever I say". */
class FakeRecogniser {
  static made: FakeRecogniser[] = []
  /** What `start()` throws, if anything. */
  static throws: string | null = null

  continuous = false
  interimResults = false
  lang = ''
  started = 0
  aborted = 0
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null

  constructor() {
    FakeRecogniser.made.push(this)
  }

  start() {
    if (FakeRecogniser.throws) throw new Error(FakeRecogniser.throws)
    this.started++
  }

  stop() {
    // The platform has one; nothing here calls it.
  }

  abort() {
    this.aborted++
  }

  /** One final result, the shape the platform sends it in. */
  say(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, 0: { transcript } } },
    })
  }
}

function withRecogniser(): typeof FakeRecogniser {
  FakeRecogniser.made = []
  FakeRecogniser.throws = null
  vi.stubGlobal('webkitSpeechRecognition', FakeRecogniser)
  return FakeRecogniser
}

describe('the fallback order', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function ears(over: Partial<Ears> = {}): { ears: Ears; failed: string[] } {
    const failed: string[] = []
    return {
      failed,
      ears: {
        microphone: vi.fn(async () => true),
        canTranscribe: () => true,
        transcribe: vi.fn(async () => 'next'),
        heard: () => undefined,
        failed: (why) => void failed.push(why),
        ...over,
      },
    }
  }

  test('prefers the phone, which is free and faster', async () => {
    const made = withRecogniser()
    const { ears: one } = ears()
    const voice = new Voice(one)

    expect(voice.path).toBe('webview')
    expect(await voice.start()).toBe(true)
    expect(made.made).toHaveLength(1)
    expect(one.microphone).not.toHaveBeenCalled()
  })

  /** The one that matters: the constructor being on the page says nothing at all
   *  about whether this WebView can recognise anything. */
  test('falls to the glasses at once when the phone says it cannot listen', async () => {
    const made = withRecogniser()
    const { ears: one, failed } = ears()
    const voice = new Voice(one)
    await voice.start()

    made.made[0]?.onerror?.({ error: 'service-not-allowed' })
    await vi.waitFor(() => expect(one.microphone).toHaveBeenCalledWith(true))

    expect(failed).toEqual(['the phone cannot listen'])
    expect(voice.state.detail).toBe('service-not-allowed')
    expect(voice.path).toBe('glasses')
    expect(voice.listening).toBe(true)
    // And it is not tried again: it has already said it cannot.
    expect(made.made[0]?.aborted).toBe(1)
  })

  test('does the same for every error that means this WebView cannot', async () => {
    for (const why of ['network', 'not-allowed', 'audio-capture', 'language-not-supported']) {
      const made = withRecogniser()
      const { ears: one } = ears()
      const voice = new Voice(one)
      await voice.start()

      made.made[0]?.onerror?.({ error: why })
      await vi.waitFor(() => expect(one.microphone).toHaveBeenCalledWith(true))
      expect(voice.path, why).toBe('glasses')
    }
  })

  test('keeps listening through the errors that only mean nobody spoke', async () => {
    const made = withRecogniser()
    const { ears: one, failed } = ears()
    const voice = new Voice(one)
    await voice.start()

    made.made[0]?.onerror?.({ error: 'no-speech' })
    made.made[0]?.onerror?.({ error: 'aborted' })

    expect(failed).toEqual([])
    expect(one.microphone).not.toHaveBeenCalled()
    expect(voice.path).toBe('webview')
  })

  test('falls to the glasses when the recogniser will not even start', async () => {
    const made = withRecogniser()
    made.throws = 'no'
    const { ears: one } = ears()
    const voice = new Voice(one)

    expect(await voice.start()).toBe(true)
    expect(one.microphone).toHaveBeenCalledWith(true)
    expect(voice.path).toBe('glasses')
  })

  test('says there is no way to listen when the microphone will not open either', async () => {
    const made = withRecogniser()
    made.throws = 'no'
    const { ears: one, failed } = ears({
      canTranscribe: () => false,
      microphone: vi.fn(async () => false),
    })
    const voice = new Voice(one)

    expect(await voice.start()).toBe(false)
    expect(failed).toEqual(['no microphone'])
  })

  /** The key lives on the account and the account answers a moment after the
   *  bridge comes up. Decided once at the start, the answer was always no. */
  test('asks whether there is a key every time rather than once at the start', async () => {
    let key = false
    const { ears: one } = ears({ canTranscribe: () => key })
    const voice = new Voice(one)

    // The microphone opens either way; what changes is whether anything can be made
    // of what it hears, and that is asked when an utterance arrives.
    await voice.start()
    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    expect(one.transcribe).not.toHaveBeenCalled()

    key = true
    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(one.transcribe).toHaveBeenCalled())
  })
})

/* ── What one screenshot of the phone has to answer ───────────────────── */

describe('the readout', () => {
  function ears(over: Partial<Ears> = {}): { ears: Ears; states: Listening[] } {
    const states: Listening[] = []
    return {
      states,
      ears: {
        microphone: vi.fn(async () => true),
        canTranscribe: () => true,
        transcribe: vi.fn(async () => 'open page three'),
        heard: () => undefined,
        failed: () => undefined,
        said: (state) => void states.push(state),
        ...over,
      },
    }
  }

  test('starts saying nothing at all', () => {
    const { ears: one } = ears()
    expect(new Voice(one).state).toEqual({
      on: false,
      path: 'glasses',
      frames: 0,
      heard: '',
      nothing: false,
      trouble: '',
      detail: '',
    })
  })

  test('counts the sound that arrives, which is the first thing to know', async () => {
    const { ears: one } = ears()
    const voice = new Voice(one)
    await voice.start()

    expect(voice.state.frames).toBe(0)
    for (let at = 0; at < 5; at++) voice.frame(SILENCE)
    expect(voice.state.frames).toBe(5)
  })

  test('says so when the microphone opened and no sound ever came', async () => {
    vi.useFakeTimers()
    const { ears: one } = ears()
    const voice = new Voice(one)
    await voice.start()

    await vi.advanceTimersByTimeAsync(2100)
    expect(voice.state.trouble).toBe('no sound from the glasses')
    vi.useRealTimers()
  })

  test('and says nothing of the sort when sound is arriving', async () => {
    vi.useFakeTimers()
    const { ears: one } = ears()
    const voice = new Voice(one)
    await voice.start()
    voice.frame(SILENCE)

    await vi.advanceTimersByTimeAsync(2100)
    expect(voice.state.trouble).toBe('')
    vi.useRealTimers()
  })

  test('keeps the last words it heard', async () => {
    const { ears: one } = ears()
    const voice = new Voice(one)
    await voice.start()

    for (let at = 0; at < 25; at++) voice.frame(SPEECH)
    for (let at = 0; at < 40; at++) voice.frame(SILENCE)
    await vi.waitFor(() => expect(voice.state.heard).toBe('open page three'))
  })

  test('tells the phone on every change, so a screenshot is never stale', async () => {
    const { ears: one, states } = ears()
    const voice = new Voice(one)
    await voice.start()
    voice.frame(SILENCE)

    expect(states.map((state) => [state.on, state.frames])).toEqual([
      [true, 0],
      [true, 1],
    ])
  })
})
