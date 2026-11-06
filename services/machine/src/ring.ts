export const KEPT = 1024 * 1024

interface Chunk {
  seq: number
  bytes: Uint8Array
}

export class Ring {
  private chunks: Chunk[] = []
  private held = 0
  private readonly limit: number
  end: number

  constructor(start = 0, limit = KEPT) {
    this.end = start
    this.limit = limit
  }

  get start(): number {
    return this.chunks[0]?.seq ?? this.end
  }

  append(bytes: Uint8Array): number {
    const seq = this.end
    if (bytes.length === 0) return seq
    this.chunks.push({ seq, bytes })
    this.held += bytes.length
    this.end += bytes.length
    while (
      this.chunks.length > 1 &&
      this.held - (this.chunks[0]?.bytes.length ?? 0) >= this.limit
    ) {
      this.held -= this.chunks.shift()?.bytes.length ?? 0
    }
    return seq
  }

  skip(to: number): void {
    if (to <= this.end) return
    this.chunks = []
    this.held = 0
    this.end = to
  }

  since(since: number): Uint8Array | null {
    if (!Number.isSafeInteger(since) || since < this.start || since > this.end) return null
    const out = new Uint8Array(this.end - since)
    let at = 0
    for (const chunk of this.chunks) {
      const from = Math.max(0, since - chunk.seq)
      if (from >= chunk.bytes.length) continue
      out.set(chunk.bytes.subarray(from), at)
      at += chunk.bytes.length - from
    }
    return out
  }
}
