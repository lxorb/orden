/** What a refused name says, on the row and in the toast and the palette alike. Apart
 *  from reserved-name.svelte.ts because a row's field says it without that being
 *  fetched. */

import { t } from './i18n.svelte'

export const agentsHint = () => t("AGENTS is this space's agent instructions")
