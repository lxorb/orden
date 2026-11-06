/** Settings > General > Chats: what pings for every chat at once (docs/chats.md 4.11),
 *  apart from preferences.ts so the glasses' plugin, which has no chats, can stand a twin
 *  in its place (chats-settings.even.ts). */

import { EVERY_DAY, hush, WEEKDAYS, WORKING_HOURS } from './chats/hush.svelte'
import { priorities } from './chats/priorities.svelte'
import { LEVELS, type Level } from '@orden/chats/priority'
import { i18n, t } from './i18n.svelte'
import type { Field, Group } from './preferences'

/** What pings for every chat at once (docs/chats.md 4.11): the reader's keywords, the
 *  hours pings are let through, and whether a notification shows the words and makes a
 *  sound. A chat's own level and mute are the bell in its head (chats/Bell.svelte), and
 *  Do not disturb is the reader's status. On the account; see chats/hush.svelte.ts. */
export function chatsGroups(): Group[] {
  const days = hush.hours?.days.join() ?? ''
  const hoursOf = (value: string) =>
    value === 'weekdays' ? WEEKDAYS : value === 'every' ? EVERY_DAY : null
  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour * 60),
    label: i18n.when(new Date(2000, 0, 1, hour).getTime(), { timeStyle: 'short' }),
  }))
  const hours = hush.hours

  return [
    {
      title: t('Chats'),
      fields: [
        {
          kind: 'text',
          label: t('My keywords'),
          hint: t(
            'Words that notify you whenever someone writes them in a chat, separated by commas.',
          ),
          words: ['chat', 'notification', 'mention', 'highlight', 'alert'],
          placeholder: t('None'),
          initial: '',
          get: () => hush.keywords.join(', '),
          set: (line) => hush.setKeywords(line),
        },
        {
          kind: 'select',
          label: t('Hours'),
          hint: t('When chats may notify you; outside these hours they stay quiet.'),
          words: ['chat', 'notification', 'schedule', 'quiet', 'do not disturb', 'night'],
          options: [
            { value: 'always', label: t('Always') },
            { value: 'every', label: t('Every day') },
            { value: 'weekdays', label: t('Weekdays') },
          ],
          initial: 'always',
          get: () =>
            days === WEEKDAYS.join() ? 'weekdays' : days === EVERY_DAY.join() ? 'every' : 'always',
          set: (value) => {
            const chosen = hoursOf(value)
            hush.setHours(chosen ? { ...(hush.hours ?? WORKING_HOURS), days: chosen } : null)
          },
        },
        ...(hours
          ? ([
              {
                kind: 'select',
                label: t('Starts'),
                hint: t('When the hours chats may notify you begin.'),
                options: hourOptions,
                get: () => String(hours.from),
                set: (value) => hush.setHours({ ...hours, from: Number(value) }),
              },
              {
                kind: 'select',
                label: t('Ends'),
                hint: t('When the hours chats may notify you end.'),
                options: hourOptions,
                get: () => String(hours.to),
                set: (value) => hush.setHours({ ...hours, to: Number(value) }),
              },
            ] satisfies Field[])
          : []),
        {
          kind: 'switch',
          label: t('Previews'),
          hint: t('Notifications show the message itself; off shows only who wrote.'),
          words: ['chat', 'notification', 'privacy', 'hide', 'message'],
          initial: true,
          get: () => hush.previews,
          set: (on) => hush.setPreviews(on),
        },
        {
          kind: 'switch',
          label: t('Sound'),
          hint: t('Notifications make a sound.'),
          words: ['chat', 'notification', 'audio', 'ping'],
          initial: false,
          get: () => hush.sound,
          set: (on) => hush.setSound(on),
        },
        {
          kind: 'switch',
          label: t('Chat priorities'),
          hint: t(
            'Your AI gives each chat a priority when a message arrives and learns from the ones you change.',
          ),
          words: ['chat', 'priority', 'urgent', 'important', 'ai', 'sort', 'mail'],
          initial: false,
          get: () => priorities.on,
          set: (on) => priorities.setOn(on),
        },
        {
          kind: 'switch',
          label: t('Draft replies'),
          hint: t(
            'Your AI drafts a reply in your style and suggests a task, and nothing is sent or added until you choose it.',
          ),
          words: ['chat', 'draft', 'reply', 'ai', 'task', 'todo', 'suggest', 'mail'],
          initial: false,
          get: () => priorities.drafting,
          set: (on) => priorities.setDrafting(on),
        },
        ...(priorities.on
          ? ([
              {
                kind: 'select',
                label: t('Notify for'),
                hint: t('Which priorities notify you.'),
                options: [
                  { value: 'urgent', label: t('Urgent') },
                  { value: 'important', label: t('Urgent and important') },
                  { value: 'all', label: t('Everything') },
                  { value: 'none', label: t('Nothing') },
                ],
                initial: 'important',
                get: () => notifyChoice(priorities.notify),
                set: (value) => priorities.setNotify(notifyLevels(value)),
              },
            ] satisfies Field[])
          : []),
      ],
    },
  ]
}

function notifyChoice(levels: readonly Level[]): string {
  if (!levels.length) return 'none'
  if (levels.length === LEVELS.length) return 'all'
  return levels.includes('important') ? 'important' : 'urgent'
}

function notifyLevels(choice: string): Level[] {
  if (choice === 'none') return []
  if (choice === 'all') return [...LEVELS]
  return choice === 'urgent' ? ['urgent'] : ['urgent', 'important']
}
