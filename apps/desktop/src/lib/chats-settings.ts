import { EVERY_DAY, hush, WEEKDAYS, WORKING_HOURS } from './chats/hush.svelte'
import { priorities } from './chats/priorities.svelte'
import { localDate } from './region'
import type { Field } from './preferences'

export function chatsFields(): Field[] {
  const days = hush.hours?.days.join() ?? ''
  const hoursOf = (value: string) =>
    value === 'weekdays' ? WEEKDAYS : value === 'every' ? EVERY_DAY : null
  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour * 60),
    label: localDate(new Date(2000, 0, 1, hour).getTime(), { timeStyle: 'short' }),
  }))
  const hours = hush.hours

  return [
    {
      kind: 'text',
      label: 'My keywords',
      hint: 'Words that notify you whenever someone writes them in a chat, separated by commas.',
      words: ['chat', 'notification', 'mention', 'highlight', 'alert'],
      placeholder: 'None',
      initial: '',
      get: () => hush.keywords.join(', '),
      set: (line) => hush.setKeywords(line),
    },
    {
      kind: 'select',
      label: 'Hours',
      hint: 'When chats may notify you; outside these hours they stay quiet.',
      words: ['chat', 'notification', 'schedule', 'quiet', 'do not disturb', 'night'],
      options: [
        { value: 'always', label: 'Always' },
        { value: 'every', label: 'Every day' },
        { value: 'weekdays', label: 'Weekdays' },
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
            label: 'Starts',
            hint: 'When the hours chats may notify you begin.',
            options: hourOptions,
            get: () => String(hours.from),
            set: (value) => hush.setHours({ ...hours, from: Number(value) }),
          },
          {
            kind: 'select',
            label: 'Ends',
            hint: 'When the hours chats may notify you end.',
            options: hourOptions,
            get: () => String(hours.to),
            set: (value) => hush.setHours({ ...hours, to: Number(value) }),
          },
        ] satisfies Field[])
      : []),
    {
      kind: 'switch',
      label: 'Previews',
      hint: 'Notifications show the message itself; off shows only who wrote.',
      words: ['chat', 'notification', 'privacy', 'hide', 'message'],
      initial: true,
      get: () => hush.previews,
      set: (on) => hush.setPreviews(on),
    },
    {
      kind: 'switch',
      label: 'Sound',
      hint: 'Notifications make a sound.',
      words: ['chat', 'notification', 'audio', 'ping'],
      initial: false,
      get: () => hush.sound,
      set: (on) => hush.setSound(on),
    },
    {
      kind: 'switch',
      label: 'Chat priorities',
      hint: 'Your AI gives each chat a priority when a message arrives and learns from the ones you change.',
      words: ['chat', 'priority', 'urgent', 'important', 'ai', 'sort'],
      initial: false,
      get: () => priorities.on,
      set: (on) => priorities.setOn(on),
    },
    {
      kind: 'switch',
      label: 'Draft replies',
      hint: 'Your AI drafts a reply in your style and suggests a task, and nothing is sent or added until you choose it.',
      words: ['chat', 'draft', 'reply', 'ai', 'task', 'todo', 'suggest'],
      initial: false,
      get: () => priorities.drafting,
      set: (on) => priorities.setDrafting(on),
    },
  ]
}
