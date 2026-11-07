function nextTick(work: (...args: unknown[]) => void, ...args: unknown[]): void {
  queueMicrotask(() => work(...args))
}

export default {
  nextTick,
  env: {} as Record<string, string | undefined>,
  versions: {} as Record<string, string | undefined>,
  platform: 'browser',
  browser: true,
  argv: [] as string[],
  cwd: () => '/',
}
