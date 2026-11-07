export function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

export default { join }
