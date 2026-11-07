import { panelDrawable } from '../even/panel-words'
import { CATALOGUES_URL, i18n, plural, t } from '../i18n.svelte'
import { languageOptions, machineSaid } from '../language-options'
import { method } from '../mobile/bridge'
import { clipboardSharing } from './apps-clipboard.svelte'
import { crashReports } from '../crash-reports/choice.svelte'
import { DEFAULTS, modes, REMIND_BEFORE } from '../modes.svelte'
import { isPlugin } from '../plugin'
import { DEFAULT_RELOCK, NEVER, RELOCK_MINUTES, unlocks } from '../protect/unlocked.svelte'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from '../recovery'
import { recovery } from '../recovery.svelte'
import { hasTray, residency } from '../reminders/residency.svelte'
import { chatsFields } from '../chats-settings'
import { tabCycle } from '../tab-cycle.svelte'
import { fitTabs, iconTabs } from '../tab-strip/icon-tabs.svelte'
import { PREVIEW_DELAY, previewDelay } from '../tab-strip/preview-delay.svelte'
import { unloadTabs } from '../tab-strip/unloading.svelte'
import { isDesktop, isMobile, platform } from '../tauri'
import { swipeChoice } from '../back-swipe/choice.svelte'
import { BY_ID } from '../shortcuts/registry'
import { asWarning, shellName, shells, SIZES } from '../terminal/shells.svelte'
import { bothName } from '../terminal/two-ways'
import { asChannel, switchWebChannel, webChannel } from '../updater'
import { updates } from '../updates.svelte'
import { pages } from '../web-tab/pages.svelte'
import { isSaver } from '../web-tab/resting'
import { saver } from '../web-tab/saver.svelte'
import { hiddenTabs } from '../workspace/hidden-tabs.svelte'
import { quickAdd } from '../quick-add/asked.svelte'
import { isHiddenTabs } from '../workspace/sets'
import { projectsOf, setProjects } from '../rows/projects'
import { workspace } from '../workspace.svelte'
import { setWord } from '../kind-choice'
import {
  CHATS_WORD,
  chatsOn,
  hiddenKinds,
  PASS_WORD,
  passOn,
  TIME_WORD,
  timeOn,
} from '../settings.svelte'
import type { Field, Group, Pane } from './fields'
import { dns, PROVIDER_NAMES } from './dns.svelte'
import { gpu } from './gpu.svelte'
import { among } from './hold'
import { versionField } from './version.svelte'
import { keptForGood } from '../web/kept-for-good.svelte'

function twoWayFields(): Field[] {
  return Object.keys(shells.ways)
    .filter((command) => BY_ID.has(command))
    .map((command): Field => ({
      kind: 'select',
      label: bothName(command),
      hint: t(
        'Whether this key goes to Orden or to the program in the terminal, or asks each time.',
      ),
      words: ['shortcut', 'key', 'shell', 'conflict', 'ask'],
      options: [
        { value: 'ask', label: t('Always ask') },
        { value: 'app', label: BY_ID.get(command)?.label() ?? command },
        { value: 'shell', label: t('Terminal') },
      ],
      initial: 'ask',
      get: () => shells.ways[command] ?? 'ask',
      set: (value) => shells.setWay(command, value === 'app' || value === 'shell' ? value : null),
    }))
}

function terminalGroup(): Group {
  void shells.ask()

  return {
    title: t('Terminal'),
    fields: [
      {
        kind: 'select',
        key: 'general.shell',
        store: { on: shells, name: 'preferred' },
        open: true,
        label: t('Shell'),
        hint: t('The shell a new terminal starts.'),
        options: shells.list.map((one) => ({ value: one.id, label: shellName(one) })),
        get: () => shells.chosen?.id ?? '',
        set: (id) => shells.choose(id),
      },
      {
        kind: 'slider',
        key: 'general.terminalTextSize',
        store: { on: shells, name: 'size' },
        label: t('Text size'),
        hint: t('How large the text in terminals is.'),
        min: SIZES.least,
        max: SIZES.most,
        step: 1,
        unit: 'px',
        initial: SIZES.initial,
        get: () => shells.size,
        set: (size) => shells.setSize(size),
      },
      {
        kind: 'switch',
        key: 'general.terminalThemed',
        store: { on: shells, name: 'themed' },
        label: t('Colours follow the theme'),
        hint: t('Paints terminals in the theme’s colours; off keeps one fixed palette.'),
        words: ['colour', 'color', 'palette', 'ansi', 'theme', 'dark', 'light'],
        initial: true,
        get: () => shells.themed,
        set: (on) => shells.setThemed(on),
      },
      {
        kind: 'switch',
        key: 'general.restoreTerminalHistory',
        store: { on: shells, name: 'restoring' },
        label: t('Restore history'),
        hint: t(
          'Brings back what each terminal showed after Orden restarts; off forgets it on quit.',
        ),
        words: ['scrollback', 'session', 'restart', 'privacy'],
        initial: true,
        get: () => shells.restoring,
        set: (on) => shells.setRestoring(on),
      },
      {
        kind: 'select',
        key: 'general.warnBeforeQuitting',
        store: { on: shells, name: 'warning' },
        label: t('Warn before quitting'),
        hint: t(
          'Asks before Orden quits with terminals open: always, or only while something runs in one.',
        ),
        words: ['quit', 'close', 'exit', 'confirm', 'running', 'process', 'claude'],
        options: [
          { value: 'always', label: t('Always') },
          { value: 'running', label: t('When something runs') },
          { value: 'never', label: t('Never') },
        ],
        initial: 'running',
        get: () => shells.warning,
        set: (value) => shells.setWarning(asWarning(value)),
      },
      ...twoWayFields(),
    ],
  }
}

function gpuGroup(): Group {
  void gpu.ask()

  return {
    title: t('Hardware acceleration'),
    ...(gpu.line ? { caption: { text: gpu.line } } : {}),
    fields: [
      {
        kind: 'switch',
        key: 'general.hardwareAcceleration',
        store: { on: gpu, name: 'on' },
        label: t('Hardware acceleration'),
        hint: t(
          'Draws the app on the graphics card; turn it off if the window flickers or stays blank.',
        ),
        words: ['gpu', 'graphics', 'software', 'rendering', 'cpu', 'restart'],
        initial: true,
        get: () => gpu.on,
        set: (on) => void gpu.set(on),
        declare: (on: boolean) => {
          gpu.on = on
        },
      },
    ],
  }
}

function privacyGroup(): Group {
  return {
    title: t('Privacy'),
    fields: [
      {
        kind: 'switch',
        key: 'general.crashReports',
        store: { on: crashReports, name: 'on' },
        label: t('Send crash and freeze reports'),
        hint: t(
          'Sends what Orden was doing when it crashed or froze; never notes, names, paths or passwords.',
        ),
        words: ['crash', 'freeze', 'hang', 'report', 'diagnostics', 'telemetry', 'privacy'],
        initial: true,
        get: () => crashReports.on,
        set: (on) => crashReports.set(on),
      },
    ],
  }
}

function dnsGroups(): Group[] {
  void dns.ask()
  if (!dns.answered) return []
  if (!dns.offered) {
    return [
      {
        title: t('DNS'),
        caption: {
          text: t(
            'Web pages here look up addresses the way the system does; its DNS is set in the system’s own settings.',
          ),
        },
        fields: [],
      },
    ]
  }

  const fields: Field[] = [
    {
      kind: 'select',
      key: 'general.dns',
      store: { on: dns, name: 'choice' },
      label: t('DNS'),
      hint: t(
        'How web pages look up the addresses of sites. Over HTTPS, nobody between you and the provider can read or change the lookups.',
      ),
      words: ['dns', 'doh', 'dns over https', 'secure dns', 'resolver', 'server', 'privacy'],
      options: [
        { value: 'system', label: t('The system’s') },
        { value: 'automatic', label: t('The system’s, over HTTPS where it can') },
        { value: 'cloudflare', label: PROVIDER_NAMES.cloudflare },
        { value: 'google', label: PROVIDER_NAMES.google },
        { value: 'quad9', label: PROVIDER_NAMES.quad9 },
        { value: 'custom', label: t('Another provider') },
      ],
      initial: 'automatic',
      get: () => dns.choice,
      set: (value) => void dns.choose(value),
    },
  ]
  if (dns.choice === 'custom') {
    fields.push({
      kind: 'text',
      key: 'general.dnsProvider',
      store: { on: dns, name: 'custom' },
      label: t('Provider'),
      hint: dns.refused ?? t('The address of a DNS over HTTPS server, starting with https://'),
      words: ['dns', 'doh', 'template', 'server', 'custom'],
      placeholder: 'https://dns.example/dns-query',
      initial: '',
      get: () => dns.custom,
      set: (value) => void dns.provide(value),
    })
  }
  return [{ title: t('DNS'), fields }]
}

function projectFolderChoices(root: string): { value: string; label: string }[] {
  const here = projectsOf(root)
  const names =
    workspace.tree?.children
      .filter((one) => one.is_dir && !one.name.startsWith('.'))
      .map((one) => one.name) ?? []
  return [...new Set([here, ...names])]
    .sort((a, b) => a.localeCompare(b))
    .map((one) => ({ value: one, label: one }))
}

function remindersGroup(): Group {
  const exact = method('exactAlarms')
  const ask = method('askExactAlarms')

  return {
    title: t('Reminders'),
    ...(isDesktop && platform() === 'linux'
      ? { caption: { text: t('Reminders ring while Orden is open') } }
      : {}),
    fields: [
      {
        kind: 'select',
        key: 'general.remindBefore',
        store: { on: modes, name: 'remindBefore', shared: 'remindBefore' },
        label: t('Automatic'),
        hint: t('How long before a task’s time it reminds you, unless the task says otherwise.'),
        words: ['reminder', 'notification', 'alarm', 'due', 'time', 'before'],
        options: REMIND_BEFORE.map((minutes) => ({
          value: String(minutes),
          label:
            minutes < 0
              ? t('Off')
              : minutes === 0
                ? t('At the time')
                : t('{count} min', { count: minutes }),
        })),
        initial: String(DEFAULTS.remindBefore),
        get: () => String(modes.remindBefore),
        set: (value) => modes.setRemindBefore(Number(value)),
      },
      ...(hasTray
        ? ([
            {
              kind: 'switch',
              key: 'general.stayInTray',
              store: { on: residency, name: 'choice' },
              label: t('Stay in the tray'),
              hint: t(
                'Keeps Orden running in the tray after its window closes, so reminders still ring.',
              ),
              words: ['tray', 'background', 'menu bar', 'close', 'quit', 'reminder'],
              get: () => residency.on,
              set: (on) => residency.set(on),
            },
          ] satisfies Field[])
        : []),
      ...(exact && ask
        ? ([
            {
              kind: 'switch',
              label: t('Exact alarms'),
              hint: t(
                'Lets reminders ring at the exact minute rather than when the phone gets round to it.',
              ),
              words: ['alarm', 'reminder', 'exact', 'battery'],
              get: () => exact(),
              set: () => ask(),
            },
          ] satisfies Field[])
        : []),
    ],
  }
}

function caption(): { caption?: { text: string; url: string } } {
  const said = [
    i18n.machine ? machineSaid() : '',
    (isPlugin() || modes.glassesSeen) && !panelDrawable() ? t('The glasses show English.') : '',
  ].filter(Boolean)

  if (!said.length) return {}
  return { caption: { text: said.join(' '), url: CATALOGUES_URL } }
}

function keptGroup(): Group {
  keptForGood.look()
  return {
    title: t('Storage'),
    fields: [
      {
        kind: 'value',
        label: t('Persistent storage'),
        hint: t(
          'Whether this browser keeps what Orden holds here, unsent changes too, when it runs short of space. Press to ask it again.',
        ),
        words: ['storage', 'offline', 'persist', 'evict', 'quota', 'browser', 'kept'],
        get: () =>
          keptForGood.held === null ? '…' : keptForGood.held ? t('Allowed') : t('Blocked'),
        does: t('Try again'),
        press: () => void keptForGood.again(),
      },
    ],
  }
}

export function generalPane(): Pane {
  return {
    id: 'general',
    label: t('General'),
    groups: [
      {
        title: t('Recovery'),
        fields: [
          {
            kind: 'select',
            key: 'general.keepVersionEvery',
            store: { on: recovery, name: 'every', shared: 'recoveryEvery' },
            label: t('Keep a version every'),
            hint: t(
              'How often a note you are editing is saved as a version you can go back to in History.',
            ),
            words: ['backup', 'history', 'snapshot'],
            options: SNAPSHOT_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: minutes ? t('{count} min', { count: minutes }) : t('Off'),
            })),
            initial: String(DEFAULT_MINUTES),
            get: () => String(recovery.every),
            set: (value) => recovery.setEvery(Number(value)),
          },
          {
            kind: 'select',
            key: 'general.keepVersionsFor',
            store: { on: recovery, name: 'days', shared: 'recoveryDays' },
            label: t('Keep versions for'),
            hint: t('How long those versions are kept before they are deleted.'),
            options: KEEP_DAYS.map((days) => ({
              value: String(days),
              label: plural(days, { one: '{count} day', other: '{count} days' }),
            })),
            initial: String(DEFAULT_DAYS),
            get: () => String(recovery.days),
            set: (value) => recovery.setDays(Number(value)),
          },
        ],
      },
      ...(!__EVEN_PLUGIN__ && keptForGood.able ? [keptGroup()] : []),
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Protection'),
              fields: [
                {
                  kind: 'select',
                  key: 'general.relockAfter',
                  store: { on: unlocks, name: 'relock' },
                  label: t('Lock again after'),
                  hint: t(
                    'How long Orden may be in the background before what you protected locks again.',
                  ),
                  words: ['protect', 'lock', 'password', 'timeout'],
                  options: RELOCK_MINUTES.map((minutes) => ({
                    value: String(minutes),
                    label:
                      minutes === NEVER
                        ? t('Only when Orden closes')
                        : minutes === 0
                          ? t('Right away')
                          : t('{count} min', { count: minutes }),
                  })),
                  initial: String(DEFAULT_RELOCK),
                  get: () => String(unlocks.relock),
                  set: (value) => unlocks.setRelock(Number(value)),
                },
              ],
            } satisfies Group,
          ]),
      {
        title: t('Tabs'),
        fields: [
          {
            kind: 'switch',
            key: 'general.ctrlTabByUse',
            store: { on: tabCycle, name: 'byUse' },
            label: t('Ctrl+Tab in order of use'),
            hint: t(
              'Ctrl+Tab goes to the tab used last, as in VS Code; off goes through the tabs in the order they sit.',
            ),
            words: ['tabs', 'recent', 'switcher'],
            initial: false,
            get: () => tabCycle.byUse,
            set: (on) => tabCycle.setByUse(on),
          },
          {
            kind: 'switch',
            key: 'general.unloadTabs',
            store: { on: unloadTabs, name: 'on' },
            label: t('Unload tabs from their menu'),
            hint: t(
              'A tab’s menu offers Unload tab, which lets go of its page and memory until it is chosen again.',
            ),
            words: ['unload', 'discard', 'sleep', 'memory', 'ram', 'free', 'tabs'],
            initial: false,
            get: () => unloadTabs.on,
            set: (on) => unloadTabs.set(on),
          },
          ...(isMobile
            ? []
            : ([
                {
                  kind: 'switch',
                  key: 'general.iconTabs',
                  store: { on: iconTabs, name: 'on' },
                  label: t('Show other tabs as icons'),
                  hint: t(
                    'Every tab but the one in front shows only its icon; pointing at one shows its name.',
                  ),
                  words: ['icon', 'compact', 'pinned', 'title', 'tabs'],
                  initial: true,
                  get: () => iconTabs.on,
                  set: (on) => iconTabs.set(on),
                },
                {
                  kind: 'switch',
                  key: 'general.fitTabs',
                  store: { on: fitTabs, name: 'on' },
                  label: t('Tabs as wide as their names'),
                  hint: t(
                    'Each tab is only as wide as its icon, name and close button need; off, every tab is the same width.',
                  ),
                  words: ['width', 'wide', 'narrow', 'compact', 'fit', 'title', 'tabs'],
                  initial: true,
                  get: () => fitTabs.on,
                  set: (on) => fitTabs.set(on),
                },
                {
                  kind: 'slider',
                  key: 'general.tabPreviewDelay',
                  store: { on: previewDelay, name: 'ms' },
                  label: t('Tab preview delay'),
                  hint: t('How long the pointer rests on a tab before its preview shows.'),
                  words: ['hover', 'card', 'tooltip', 'preview', 'tabs'],
                  min: PREVIEW_DELAY.least,
                  max: PREVIEW_DELAY.most,
                  step: PREVIEW_DELAY.step,
                  unit: 'ms',
                  initial: PREVIEW_DELAY.initial,
                  get: () => previewDelay.ms,
                  set: (value) => previewDelay.set(value),
                },
              ] satisfies Field[])),
          ...(isMobile
            ? []
            : ([
                {
                  kind: 'switch',
                  key: 'general.swipeBetweenPages',
                  store: { on: swipeChoice, name: 'on' },
                  label: t('Swipe between pages'),
                  hint: t('Two fingers sideways on the touchpad go back and forward.'),
                  words: ['swipe', 'gesture', 'touchpad', 'trackpad', 'back', 'forward', 'history'],
                  initial: true,
                  get: () => swipeChoice.on,
                  set: (on) => swipeChoice.set(on),
                },
              ] satisfies Field[])),
          ...(isDesktop
            ? ([
                {
                  kind: 'segmented',
                  key: 'general.hiddenTabs',
                  store: { on: hiddenTabs, name: 'choice' },
                  label: t('Hidden tabs'),
                  hint: t(
                    'What the web pages of another space do while it is out of sight: keep running, pause, or ask the first time.',
                  ),
                  words: ['spaces', 'background', 'pause', 'sleep', 'freeze', 'audio'],
                  options: [
                    { value: 'run', label: t('Keep running') },
                    { value: 'pause', label: t('Pause') },
                    { value: 'ask', label: t('Ask') },
                  ],
                  initial: 'ask',
                  get: () => hiddenTabs.choice,
                  set: (value) => hiddenTabs.set(isHiddenTabs(value) ? value : 'ask'),
                },
                {
                  kind: 'select',
                  key: 'general.memorySaver',
                  store: { on: saver, name: 'mode' },
                  label: t('Memory saver'),
                  hint: t(
                    'Unloads web pages that have been out of sight for a while to free memory; they load again when you return.',
                  ),
                  words: ['memory', 'ram', 'discard', 'sleep', 'reload', 'performance'],
                  options: [
                    { value: 'off', label: t('Off') },
                    { value: 'moderate', label: t('Moderate') },
                    { value: 'balanced', label: t('Balanced') },
                    { value: 'maximum', label: t('Maximum') },
                  ],
                  initial: 'off',
                  get: () => saver.mode,
                  set: (value) => {
                    saver.set(isSaver(value) ? value : 'off')
                    pages.retime()
                  },
                },
              ] satisfies Field[])
            : []),
        ],
      },
      {
        title: t('Add task'),
        fields: [
          {
            kind: 'switch',
            key: 'general.smartDates',
            store: { on: quickAdd, name: 'smart' },
            label: t('Smart dates'),
            hint: t(
              'Reads dates, times and fields out of what you type into Add task, such as “tomorrow 9am”.',
            ),
            words: ['tasks', 'quick add', 'natural language', 'parse', 'todoist'],
            initial: true,
            get: () => quickAdd.smart,
            set: (on) => quickAdd.setSmart(on),
          },
          ...(workspace.activeSpace
            ? ([
                {
                  kind: 'select',
                  label: t('Projects folder'),
                  hint: t(
                    'The folder of this space whose folders the Tasks panel lists as projects.',
                  ),
                  words: ['tasks', 'projects', 'folder', 'todoist'],
                  options: projectFolderChoices(workspace.activeSpace.root),
                  get: () => projectsOf(workspace.activeSpace?.root ?? ''),
                  set: (value) => {
                    const root = workspace.activeSpace?.root
                    if (root !== undefined) setProjects(root, value)
                  },
                },
              ] satisfies Field[])
            : []),
          {
            kind: 'switch',
            key: 'general.undatedInToday',
            store: { on: modes, name: 'undatedInToday', shared: 'undatedInToday' },
            label: t('Show tasks without a start date in Today'),
            hint: t(
              'Today also lists the tasks that have no start date; off shows only those dated today or earlier.',
            ),
            words: ['tasks', 'today', 'start date', 'undated', 'no date', 'todoist'],
            initial: DEFAULTS.undatedInToday,
            get: () => modes.undatedInToday,
            set: (on) => modes.setUndatedInToday(on),
          },
          ...(isDesktop && !isMobile
            ? ([
                {
                  kind: 'switch',
                  key: 'general.addTaskFromAnyApp',
                  store: { on: quickAdd, name: 'anywhere' },
                  label: t('From any app'),
                  hint: t('The Add task shortcut works even while another app is in front.'),
                  words: ['tasks', 'quick add', 'global', 'hotkey', 'shortcut', 'system'],
                  initial: true,
                  get: () => quickAdd.anywhere,
                  set: (on) => quickAdd.setAnywhere(on),
                },
              ] satisfies Field[])
            : []),
        ],
      },
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Code'),
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.developerMode',
                  store: { on: modes, name: 'developer', shared: 'developer' },
                  label: t('Developer mode'),
                  hint: t('Shows terminals and the other tools for writing code.'),
                  words: ['coder', 'coding', 'programmer', 'terminal', 'shell', 'ssh'],
                  initial: true,
                  get: () => modes.coder,
                  set: (on: boolean) => modes.setDeveloper(on),
                },
                ...(modes.coder
                  ? [
                      {
                        kind: 'switch' as const,
                        label: t('Share the clipboard with applications'),
                        hint: t(
                          'An application on another of your computers pastes what you copied here, and what it copies comes here.',
                        ),
                        words: ['clipboard', 'copy', 'paste', 'application', 'remote'],
                        initial: true,
                        get: () => clipboardSharing.on,
                        set: (on: boolean) => clipboardSharing.set(on),
                      },
                    ]
                  : []),
              ],
            },
          ]),
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Chats'),
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.chats',
                  store: { ...among(hiddenKinds, 'hidden', CHATS_WORD), shared: 'hiddenKinds' },
                  label: t('Chats'),
                  hint: t(
                    'Adds chats with people, mail, Telegram, Slack, WhatsApp and Signal; turning it off keeps your messages.',
                  ),
                  words: [
                    'chat',
                    'chats',
                    'messages',
                    'mail',
                    'telegram',
                    'slack',
                    'whatsapp',
                    'signal',
                  ],
                  initial: false,
                  get: () => chatsOn(),
                  set: (on: boolean) => setWord(CHATS_WORD, on),
                },
                ...(chatsOn() && !isMobile ? chatsFields() : []),
              ],
            },
          ]),
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Time tracker'),
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.timeTracker',
                  store: { ...among(hiddenKinds, 'hidden', TIME_WORD), shared: 'hiddenKinds' },
                  label: t('Time tracker'),
                  hint: t(
                    'Adds a timer and records the app, site and tab in front and how busy the computer is.',
                  ),
                  words: ['time', 'tracking', 'timer', 'hours', 'activity', 'screen time', 'toggl'],
                  initial: false,
                  get: () => timeOn(),
                  set: (on: boolean) => setWord(TIME_WORD, on),
                },
              ],
            },
          ]),
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Password manager'),
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.passwordManager',
                  store: { ...among(hiddenKinds, 'hidden', PASS_WORD), shared: 'hiddenKinds' },
                  label: t('Password manager'),
                  hint: t(
                    'Adds Pass, which keeps passwords and fills them in on websites; turning it off keeps your vaults.',
                  ),
                  words: [
                    'pass',
                    'password',
                    'passwords',
                    'vault',
                    'autofill',
                    'login',
                    'keychain',
                  ],
                  initial: false,
                  get: () => passOn(),
                  set: (on: boolean) => setWord(PASS_WORD, on),
                },
              ],
            },
          ]),
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Hints'),
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.silentMode',
                  store: { on: modes, name: 'silent', shared: 'silent' },
                  label: t('Silent mode'),
                  hint: t('Hides the tips Orden shows while you get to know it.'),
                  words: ['tips', 'hints', 'quiet', 'clean', 'onboarding'],
                  initial: DEFAULTS.silent,
                  get: () => modes.silent,
                  set: () => modes.toggleSilent(),
                },
              ],
            },
          ]),
      {
        title: t('Language'),
        ...caption(),
        fields: [
          {
            kind: 'select',
            key: 'general.language',
            store: { on: i18n, name: 'choice' },
            label: t('Language'),
            hint: t('The language Orden’s menus and settings are in.'),
            options: languageOptions(),
            get: () => i18n.choice,
            set: (value) => i18n.select(value),
          },
        ],
      },

      ...(__EVEN_PLUGIN__ ? [] : [remindersGroup()]),

      ...(!__EVEN_PLUGIN__ && isDesktop && modes.coder ? [terminalGroup()] : []),

      ...(!__EVEN_PLUGIN__ && isDesktop && ['linux', 'windows'].includes(platform())
        ? [gpuGroup()]
        : []),

      ...(!__EVEN_PLUGIN__ && isDesktop ? dnsGroups() : []),

      ...(!__EVEN_PLUGIN__ && isDesktop ? [privacyGroup()] : []),

      {
        title: t('Updates'),
        fields: [
          ...(isDesktop
            ? ([
                {
                  kind: 'segmented',
                  label: t('Release channel'),
                  words: ['beta', 'updates', 'nightly'],
                  hint: t(
                    'Stable follows released versions; Unstable follows edge builds and can break.',
                  ),
                  options: [
                    { value: 'stable', label: t('Stable') },
                    { value: 'unstable', label: t('Unstable') },
                  ],
                  initial: 'stable',
                  get: () => updates.channel,
                  set: (value) => updates.setChannel(asChannel(value)),
                },
              ] satisfies Field[])
            : []),
          ...(!__EVEN_PLUGIN__ && webChannel
            ? ([
                {
                  kind: 'segmented',
                  label: t('Web version'),
                  words: ['beta', 'updates', 'nightly', 'channel', 'edge'],
                  hint: t(
                    'Stable is the released web app; Unstable is the newest build and can break.',
                  ),
                  options: [
                    { value: 'stable', label: t('Stable') },
                    { value: 'unstable', label: t('Unstable') },
                  ],
                  initial: 'stable',
                  get: () => webChannel ?? 'stable',
                  set: (value) => switchWebChannel(asChannel(value)),
                },
              ] satisfies Field[])
            : []),
          versionField(),
        ],
      },
    ],
  }
}
