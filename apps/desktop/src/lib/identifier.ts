let handed = 0

export function identifier(): string {
  return `${(handed++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
