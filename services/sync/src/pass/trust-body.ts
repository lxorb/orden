import { objectBody } from '../body'

interface HasJson {
  req: { json: <T>() => Promise<T>; header?: (name: string) => string | undefined }
}

export async function fieldsSent(source: HasJson): Promise<Record<string, unknown>> {
  return (await objectBody(source)) ?? {}
}

export function optionalIn<T>(
  value: unknown,
  read: (one: unknown) => T | null,
): T | null | undefined {
  if (value === undefined || value === null) return null
  return read(value) ?? undefined
}

export function jsonOf(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value)
}
