const PHONES = ['android', 'ios']
export function carriesAi(mode: string, platform = process.env.TAURI_ENV_PLATFORM ?? ''): boolean {
  return mode !== 'web' && !PHONES.includes(platform)
}
