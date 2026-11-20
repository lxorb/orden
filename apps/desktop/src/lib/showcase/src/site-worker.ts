import { siteAnswer } from './site'

interface Site {
  ASSETS: { fetch(request: Request): Promise<Response> }
}
export default {
  fetch: (request: Request, env: Site) => siteAnswer(request, env.ASSETS),
}
