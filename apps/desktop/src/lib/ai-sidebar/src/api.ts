import { partView } from '../../ui-kit/src/api'

export const loadChatPanel = () => import('./ChatPanel.svelte')
export const loadQuickQuestion = () => import('./QuickQuestion.svelte')
export const aiPane = async () => partView((await import('./AiPane.svelte')).default, () => ({}))
