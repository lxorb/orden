const THEME_SCRIPT = "'sha256-iR2Aqj1jRJSx35wTBtrVLSatm9gSp55tpjHpCB3GAHs='"

const FRAME_SCRIPT = "'sha256-UbMWxIrbtKcJ1D+PYnMVHHSMulvzvKPmSd348Qc5i9k='"

const DECK_LAYOUT = "'sha256-7EyWWoiOaEITiSnztLnl41c924jo2MevGJiwDThhx64='"

const POLICY: readonly string[] = [
  "default-src 'self'",

  `script-src 'self' 'unsafe-eval' ${THEME_SCRIPT} ${FRAME_SCRIPT} ${DECK_LAYOUT}`,
  "script-src-attr 'none'",

  "style-src 'self' 'unsafe-inline'",

  "img-src 'self' data: blob: https: asset: http://asset.localhost",
  "media-src 'self' data: blob: https: asset: http://asset.localhost",

  "font-src 'self' data:",

  "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:*" +
    ' http://localhost:* http://127.0.0.1:*' +
    ' ipc: http://ipc.localhost asset: http://asset.localhost blob: data:',

  "frame-src 'self' https:",

  "worker-src 'self' blob:",

  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]

const ONLY_AS_HEADER: readonly string[] = ["frame-ancestors 'none'"]

export const META_CSP: string = POLICY.join('; ')

export const CSP: string = [...POLICY, ...ONLY_AS_HEADER].join('; ')
