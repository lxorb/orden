const SERVICE = new URL('../../../../../../services/sync/', import.meta.url).href
interface Env {
  db: { exec(sql: string): void }
  close(): void
}
interface Answer<T> {
  status: number
  json: T
}
interface Harness {
  testEnv: () => Env
  signIn: (env: Env, email: string) => Promise<string>
  call: <T>(
    env: Env,
    path: string,
    options?: { token?: string; body?: unknown; method?: string },
  ) => Promise<Answer<T>>
}
interface Worker {
  default: { fetch(request: Request, env: Env): Promise<Response> }
}
export const { default: worker } = (await import(
  /* @vite-ignore */ `${SERVICE}src/index.ts`
)) as Worker
export const { call, signIn, testEnv } = (await import(
  /* @vite-ignore */ `${SERVICE}test/harness.ts`
)) as Harness
