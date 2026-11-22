/// <reference types="vite/client" />
declare const __ORDEN_BUILD__: string
declare const __DRIVEABLE__: boolean
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __CLAUDE_CODE__: boolean
declare const __AI__: boolean
interface ImportMetaEnv {
  readonly VITE_ORDEN_API?: string
  readonly VITE_ORDEN_THEMES?: string
  readonly VITE_ORDEN_WEB?: string
  readonly VITE_ORDEN_LEGACY_WEB?: string
  readonly VITE_ORDEN_CHANNEL?: string
}
declare module 'virtual:noto-outlines' {
  const drawn: Record<string, string>
  export default drawn
}
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
