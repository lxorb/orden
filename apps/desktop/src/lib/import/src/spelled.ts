import { type LinkFormat, linkWriting, setLinkWriting } from '../../link-format/src/api'

export async function spelledAs<T>(format: LinkFormat | undefined, read: () => Promise<T>): Promise<T> {
  if (!format) return read()
  const was = linkWriting()
  setLinkWriting(format)
  try {
    return await read()
  } finally {
    setLinkWriting(was)
  }
}
