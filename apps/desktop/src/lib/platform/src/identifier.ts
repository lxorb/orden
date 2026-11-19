let handed = 0
export const identifier = (): string => `${(handed++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
