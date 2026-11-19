import { storeBeside, workspace } from '../../../workspace/src/api'
import { busy, message, reloading } from '../../../ui-kit/src/api'
import { links } from '../../../link-index/src/api'
import { askSheet, sayNotice } from '@orden/contracts'
import { nameOf, spaceRelative } from '../../../platform/src/api'
import { canRecordHere, recordingName } from './container'
import { MOST_BYTES, record, type Recording } from './microphone'
import { appendTo, mayRecordInto, noteToRecordInto, viewFor, writeAtCaret } from './note'
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
    void askSheet('recording-pill')
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
        full: () => void this.stop().then(() => busy.failed('That is as much as one recording may hold.')),
      })
      this.at = performance.now()
      this.ticking = setInterval(() => {
        this.elapsed = (performance.now() - this.at) / 1000
      }, TICK)
      if (this.stopAsked) void this.stop()
    } catch (error) {
      this.on = false
      this.held = null
      this.stopAsked = false
      sayNotice(message(error, 'That microphone could not be opened.'))
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
      sayNotice(message(error, 'That recording could not be saved.'))
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
}
export const recorder = new Recorder()
reloading.holds(() => recorder.on || recorder.saving)
