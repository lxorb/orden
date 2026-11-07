import { isSealedExport, openExport } from '@orden/pass/export'
import { type Imported, importFile, needsZip, type SourceId } from '@orden/pass/import/index'

const MIB = 1024 * 1024

const ZIP_LIMITS = { total: 200 * MIB, entries: 10_000, file: 100 * MIB }

export const ZIP_TOO_BIG =
  'This archive is too big to import: at most 10,000 files, 100 MiB a file and 200 MiB in all.'

interface Unpacking {
  on(event: 'data', run: (chunk: Uint8Array) => void): Unpacking
  on(event: 'end', run: () => void): Unpacking
  on(event: 'error', run: (error: Error) => void): Unpacking
  pause(): Unpacking
  resume(): Unpacking
}

interface Streamable {
  internalStream(type: 'uint8array'): Unpacking
}

function unpacked(stream: Unpacking, room: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    stream
      .on('data', (chunk) => {
        size += chunk.length
        if (size > room) {
          stream.pause()
          reject(new Error(ZIP_TOO_BIG))
          return
        }
        chunks.push(chunk)
      })
      .on('error', reject)
      .on('end', () => {
        const body = new Uint8Array(size)
        let at = 0
        for (const chunk of chunks) {
          body.set(chunk, at)
          at += chunk.length
        }
        resolve(body)
      })
      .resume()
  })
}

export async function unzipped(
  bytes: Uint8Array,
  limits = ZIP_LIMITS,
): Promise<Record<string, Uint8Array>> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length > limits.entries) throw new Error(ZIP_TOO_BIG)
  const files: Record<string, Uint8Array> = {}
  let total = 0
  for (const entry of entries) {
    const room = Math.min(limits.file, limits.total - total)
    const body = await unpacked((entry as unknown as Streamable).internalStream('uint8array'), room)
    total += body.length
    files[entry.name] = body
  }
  return files
}

export function isSealed(source: SourceId, bytes: Uint8Array): boolean {
  return source === 'orden' && isSealedExport(new TextDecoder().decode(bytes))
}

export async function importedFrom(
  source: SourceId,
  name: string,
  bytes: Uint8Array,
  passphrase: string,
): Promise<Imported> {
  if (needsZip(source, name)) return importFile(source, name, await unzipped(bytes))
  if (!isSealed(source, bytes)) return importFile(source, name, bytes)
  const opened = await openExport(new TextDecoder().decode(bytes), passphrase)
  return importFile(source, name, new TextEncoder().encode(opened))
}
