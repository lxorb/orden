/// <reference types="vite/client" />

declare const __EVEN_BUILD__: string

declare const __EVEN_PLUGIN__: boolean

declare const __DRIVEABLE__: boolean

declare const __APP_VERSION__: string

declare const __APP_COMMIT__: string

declare const __CLAUDE_CODE__: boolean

interface ImportMetaEnv {
  readonly VITE_ORDEN_API?: string
  readonly VITE_ORDEN_THEMES?: string
  readonly VITE_ORDEN_WEB?: string
  readonly VITE_ORDEN_LEGACY_WEB?: string
  readonly VITE_ORDEN_CHANNEL?: string
  readonly VITE_ORDEN_GOOGLE_CLIENT_ID?: string
  readonly VITE_ORDEN_GOOGLE_CLIENT_SECRET?: string
  readonly VITE_ORDEN_MICROSOFT_CLIENT_ID?: string
  readonly VITE_ORDEN_TELEGRAM_API_ID?: string
  readonly VITE_ORDEN_TELEGRAM_API_HASH?: string
  readonly VITE_ORDEN_SLACK_CLIENT_ID?: string
}

declare module 'virtual:noto-outlines' {
  const drawn: Record<string, string>
  export default drawn
}
