import { storeBeside } from '../assets'
import { busy } from '../busy.svelte'
import { message } from '../message'
import { links } from '../link-index.svelte'
import { reloading } from '../reloading.svelte'
import { settings } from '../settings.svelte'
import { nameOf } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { canRecordHere, recordingName } from './container'
import { MOST_BYTES, record, type Recording } from './microphone'
import { appendTo, mayRecordInto, noteToRecordInto, viewFor, writeAtCaret } from './note'
import { spaceRelative } from './paths'
import { recordingPill } from '../surfaces.svelte'
import { embedFor } from './transcript'

const TICK = 500

class Recorder {
  private held: Recording | null = null

  on = $state(false)

  saving = $state(false)

  elapsed = $state(0)

  private ticking: ReturnType<typeof setInterval> | undefined
  private stopAsked = false
  private started = new Date()
  private at = performance.now()

  private path: string | null = null

  get available(): boolean {
    return canRecordHere()
  }

  toggle() {
    if (this.on) {
      void this.stop()
      return
    }

    void recordingPill.ask()

    void this.start()
  }

  async start() {
    if (this.on) return

    this.started = new Date()
    this.reset()
    this.on = true

    try {
      const path = await noteToRecordInto()
      if (!path) throw new Error('Open a space to record into.')
      this.path = path

      this.held = await record({
        full: () => this.failed('That is as much as one recording may hold.'),
      })

      this.ticking = setInterval(() => {
        this.elapsed = (performance.now() - this.at) / 1000
      }, TICK)

      if (this.stopAsked) void this.stop()
    } catch (error) {
      this.on = false
      this.held = null
      this.stopAsked = false
      settings.error = message(error, 'That microphone could not be opened.')
    }
  }

  private reset() {
    this.at = performance.now()
    this.elapsed = 0
    this.path = null
    busy.clear()
  }

  async stop() {
    const held = this.held
    const path = this.path
    if (!this.on) return

    if (!held) {
      this.stopAsked = true
      return
    }

    this.stopAsked = false
    this.on = false
    this.saving = true
    this.held = null
    clearInterval(this.ticking)

    try {
      await busy.run('Saving the recording', async () => {
        const file = await held.stop()
        this.elapsed = file.seconds

        if (!path) throw new Error('Open a space to record into.')
        await this.keep(path, file.bytes, held.extension)
      })
    } catch (error) {
      settings.error = message(error, 'That recording could not be saved.')
    } finally {
      this.saving = false
      void workspace.writesSettled()
    }
  }

  private async keep(path: string, bytes: ArrayBuffer, extension: string) {
    if (bytes.byteLength > MOST_BYTES) {
      throw new Error('That is as much as one recording may hold.')
    }
    if (!mayRecordInto(path)) throw new Error('That recording could not be saved.')

    const written = await storeBeside(bytes, path, recordingName(this.started, extension))
    if (!written) throw new Error('That recording could not be saved.')

    const root = workspace.rootHolding(path)
    const relative = root ? spaceRelative(root, path, written) : null
    if (root && relative) links.fileWritten(root, relative)

    const embed = embedFor(nameOf(written))
    const view = viewFor(path)

    if (view) writeAtCaret(view, embed)
    else appendTo(path, `\n${embed}\n`)

    void workspace.loadTree()
  }

  private failed(reason: string) {
    busy.failed(reason)
  }
}

export const recorder = new Recorder()

reloading.holds(() => recorder.on || recorder.saving)
