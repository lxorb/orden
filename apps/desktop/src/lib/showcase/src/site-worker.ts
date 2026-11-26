import { downloadAnswer, isDownloadPath, type Later } from './download'
import { siteAnswer } from './site'

interface Site {
  ASSETS: { fetch(request: Request): Promise<Response> }
  POSTHOG_KEY?: string
}
export default {
  fetch: (request: Request, env: Site, later: Later) =>
    isDownloadPath(new URL(request.url).pathname)
      ? downloadAnswer(request, env, later)
      : siteAnswer(request, env.ASSETS),
}
