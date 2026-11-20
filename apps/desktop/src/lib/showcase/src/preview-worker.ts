import { previewAnswer } from './site'

interface Site {
  ASSETS: { fetch(request: Request): Promise<Response> }
}
export default {
  fetch: (request: Request, env: Site) => previewAnswer(request, env.ASSETS),
}
