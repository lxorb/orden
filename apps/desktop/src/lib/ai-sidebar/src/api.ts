import { partView } from '../../ui-kit/src/api'

export const loadChatPanel = () =>
  __EVEN_PLUGIN__ ? Promise.reject(new Error('no AI panel in the Even Realities plugin')) : import('./ChatPanel.svelte')

export const loadQuickQuestion = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no quick question in the Even Realities plugin'))
    : import('./QuickQuestion.svelte')

export const aiPane = async () => partView((await import('./AiPane.svelte')).default, () => ({}))
