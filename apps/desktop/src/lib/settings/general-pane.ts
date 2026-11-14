import { method, isDesktop, isMobile, platform } from '../platform/src/api'
import { crashReports } from '../crash-reports/src/api'
import { usageChoice } from '../usage/src/api'
import { DEFAULTS, modes, REMIND_BEFORE } from '../modes.svelte'
import { protectionOn, turnProtection } from '../sharing/src/api'
import { DEFAULT_RELOCK, NEVER, RELOCK_MINUTES, unlocks } from '../protect/src/api'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from '../recovery'
import { recovery } from '../recovery.svelte'
import { hasTray, residency } from '../residency.svelte'
import { tabCycle } from '../tab-cycle.svelte'
import { fitTabs, iconTabs } from '../tab-strip/icon-tabs.svelte'
import { PREVIEW_DELAY, previewDelay } from '../tab-strip/preview-delay.svelte'
import { unloadTabs } from '../tab-strip/unloading.svelte'
import { swipeChoice } from '../back-swipe/src/api'
import { BY_ID } from '../shortcuts/registry'
import { asWarning, shellName, shells, SIZES, bothName } from '../terminal/src/api'
import { asChannel, switchWebChannel, webChannel } from '../updater'
import { updates } from '../updates.svelte'
import { pages } from '../web-tab/src/api'
import { isSaver } from '../web-tab/src/resting'
import { saver } from '../web-tab/src/saver.svelte'
import { hiddenTabs } from '../workspace/hidden-tabs.svelte'
import { quickAdd } from '../quick-add/src/api'
import { isHiddenTabs } from '../workspace/sets'
import type { Field, Group, Pane } from './fields'
import { gpu } from './gpu.svelte'
import { versionField } from './version.svelte'
import { keptForGood } from '../web/kept-for-good.svelte'

function twoWayFields(): Field[] {
  return Object.keys(shells.ways)
    .filter((command) => BY_ID.has(command))
    .map((command): Field => ({
      kind: 'select',
      label: bothName(command),
      hint: 'Whether this key goes to Orden or to the program in the terminal, or asks each time.',
      words: ['shortcut', 'key', 'shell', 'conflict', 'ask'],
      options: [
        { value: 'ask', label: 'Always ask' },
        { value: 'app', label: BY_ID.get(command)?.label() ?? command },
        { value: 'shell', label: 'Terminal' },
      ],
      initial: 'ask',
      get: () => shells.ways[command] ?? 'ask',
      set: (value) => shells.setWay(command, value === 'app' || value === 'shell' ? value : null),
    }))
}

function terminalGroup(): Group {
  void shells.ask()

  return {
    title: 'Terminal',
    fields: [
      {
        kind: 'select',
        key: 'general.shell',
        open: true,
        label: 'Shell',
        hint: 'The shell a new terminal starts.',
        options: shells.list.map((one) => ({ value: one.id, label: shellName(one) })),
        get: () => shells.chosen?.id ?? '',
        set: (id) => shells.choose(id),
      },
      {
        kind: 'slider',
        key: 'general.terminalTextSize',
        label: 'Text size',
        hint: 'How large the text in terminals is.',
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
        label: 'Colours follow the theme',
        hint: 'Paints terminals in the theme’s colours; off keeps one fixed palette.',
        words: ['colour', 'color', 'palette', 'ansi', 'theme', 'dark', 'light'],
        initial: true,
        get: () => shells.themed,
        set: (on) => shells.setThemed(on),
      },
      {
        kind: 'switch',
        key: 'general.restoreTerminalHistory',
        label: 'Restore history',
        hint: 'Brings back what each terminal showed after Orden restarts; off forgets it on quit.',
        words: ['scrollback', 'session', 'restart', 'privacy'],
        initial: true,
        get: () => shells.restoring,
        set: (on) => shells.setRestoring(on),
      },
      {
        kind: 'select',
        key: 'general.warnBeforeQuitting',
        label: 'Warn before quitting',
        hint: 'Asks before Orden quits with terminals open: always, or only while something runs in one.',
        words: ['quit', 'close', 'exit', 'confirm', 'running', 'process', 'claude'],
        options: [
          { value: 'always', label: 'Always' },
          { value: 'running', label: 'When something runs' },
          { value: 'never', label: 'Never' },
        ],
        initial: 'running',
        get: () => shells.warning,
        set: (value) => shells.setWarning(asWarning(value)),
      },
      ...twoWayFields(),
    ],
  }
}

export function relockField(): Field {
  return {
    kind: 'select',
    key: 'general.relockAfter',
    label: 'Lock again after',
    hint: 'How long Orden may be in the background before what you protected locks again.',
    words: ['protect', 'lock', 'password', 'timeout'],
    options: RELOCK_MINUTES.map((minutes) => ({
      value: String(minutes),
      label:
        minutes === NEVER
          ? 'Only when Orden closes'
          : minutes === 0
            ? 'Right away'
            : `${minutes} min`,
    })),
    initial: String(DEFAULT_RELOCK),
    get: () => String(unlocks.relock),
    set: (value) => unlocks.setRelock(Number(value)),
  }
}

function gpuGroup(): Group {
  void gpu.ask()

  return {
    title: 'Hardware acceleration',
    ...(gpu.line ? { caption: { text: gpu.line } } : {}),
    fields: [
      {
        kind: 'switch',
        key: 'general.hardwareAcceleration',
        label: 'Hardware acceleration',
        hint: 'Draws the app on the graphics card; turn it off if the window flickers or stays blank.',
        words: ['gpu', 'graphics', 'software', 'rendering', 'cpu', 'restart'],
        initial: true,
        get: () => gpu.on,
        set: (on) => void gpu.set(on),
      },
    ],
  }
}

function privacyGroup(): Group {
  return {
    title: 'Privacy',
    fields: [
      {
        kind: 'switch',
        key: 'general.crashReports',
        label: 'Send crash and freeze reports',
        hint: 'Sends what Orden was doing when it crashed or froze; never notes, names, paths or passwords.',
        words: ['crash', 'freeze', 'hang', 'report', 'diagnostics', 'telemetry', 'privacy'],
        initial: true,
        get: () => crashReports.on,
        set: (on) => crashReports.set(on),
      },
      {
        kind: 'switch',
        key: 'general.usageData',
        label: 'Share anonymous usage data',
        hint: 'Sends daily counts of what you use under a random ID; never notes, names, paths or what you type.',
        words: ['analytics', 'telemetry', 'usage', 'statistics', 'improve', 'privacy'],
        initial: false,
        get: () => usageChoice.helping,
        set: (on) => usageChoice.setHelping(on),
      },
    ],
  }
}

function remindersGroup(): Group {
  const exact = method('exactAlarms')
  const ask = method('askExactAlarms')

  return {
    title: 'Reminders',
    ...(isDesktop && platform() === 'linux'
      ? { caption: { text: 'Reminders ring while Orden is open' } }
      : {}),
    fields: [
      {
        kind: 'select',
        key: 'general.remindBefore',
        label: 'Automatic',
        hint: 'How long before a task’s time it reminds you, unless the task says otherwise.',
        words: ['reminder', 'notification', 'alarm', 'due', 'time', 'before'],
        options: REMIND_BEFORE.map((minutes) => ({
          value: String(minutes),
          label: minutes < 0 ? 'Off' : minutes === 0 ? 'At the time' : `${minutes} min`,
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
              label: 'Stay in the tray',
              hint: 'Keeps Orden running in the tray after its window closes, so chat notices still arrive.',
              words: ['tray', 'background', 'menu bar', 'close', 'quit'],
              get: () => residency.on,
              set: (on) => residency.set(on),
            },
          ] satisfies Field[])
        : []),
      ...(exact && ask
        ? ([
            {
              kind: 'switch',
              label: 'Exact alarms',
              hint: 'Lets reminders ring at the exact minute rather than when the phone gets round to it.',
              words: ['alarm', 'reminder', 'exact', 'battery'],
              get: () => exact(),
              set: () => ask(),
            },
          ] satisfies Field[])
        : []),
    ],
  }
}

function keptGroup(): Group {
  keptForGood.look()
  return {
    title: 'Storage',
    fields: [
      {
        kind: 'value',
        label: 'Persistent storage',
        hint: 'Whether this browser keeps what Orden holds here, unsent changes too, when it runs short of space. Press to ask it again.',
        words: ['storage', 'offline', 'persist', 'evict', 'quota', 'browser', 'kept'],
        get: () => (keptForGood.held === null ? '…' : keptForGood.held ? 'Allowed' : 'Blocked'),
        does: 'Try again',
        press: () => void keptForGood.again(),
      },
    ],
  }
}

export function generalPane(): Pane {
  return {
    id: 'general',
    label: 'General',
    groups: [
      {
        title: 'Recovery',
        fields: [
          {
            kind: 'select',
            key: 'general.keepVersionEvery',
            label: 'Keep a version every',
            hint: 'How often a note you are editing is saved as a version you can go back to in History.',
            words: ['backup', 'history', 'snapshot'],
            options: SNAPSHOT_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: minutes ? `${minutes} min` : 'Off',
            })),
            initial: String(DEFAULT_MINUTES),
            get: () => String(recovery.every),
            set: (value) => recovery.setEvery(Number(value)),
          },
          {
            kind: 'select',
            key: 'general.keepVersionsFor',
            label: 'Keep versions for',
            hint: 'How long those versions are kept before they are deleted.',
            options: KEEP_DAYS.map((days) => ({
              value: String(days),
              label: days === 1 ? '1 day' : `${days} days`,
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
              title: 'Protection',
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.protection',
                  label: 'Use protection',
                  hint: 'Adds Protect to menus, to keep notes, folders and spaces behind a password or this device’s lock.',
                  words: ['protect', 'lock', 'password', 'private', 'hide'],
                  initial: false,
                  get: () => protectionOn(),
                  set: (on: boolean) => void turnProtection(on),
                },
                ...(protectionOn() ? [relockField()] : []),
              ],
            } satisfies Group,
          ]),
      {
        title: 'Tabs',
        fields: [
          {
            kind: 'switch',
            key: 'general.ctrlTabByUse',
            label: 'Ctrl+Tab in order of use',
            hint: 'Ctrl+Tab goes to the tab used last, as in VS Code; off goes through the tabs in the order they sit.',
            words: ['tabs', 'recent', 'switcher'],
            initial: false,
            get: () => tabCycle.byUse,
            set: (on) => tabCycle.setByUse(on),
          },
          {
            kind: 'switch',
            key: 'general.unloadTabs',
            label: 'Unload tabs from their menu',
            hint: 'A tab’s menu offers Unload tab, which lets go of its page and memory until it is chosen again.',
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
                  label: 'Show other tabs as icons',
                  hint: 'Every tab but the one in front shows only its icon; pointing at one shows its name.',
                  words: ['icon', 'compact', 'pinned', 'title', 'tabs'],
                  initial: true,
                  get: () => iconTabs.on,
                  set: (on) => iconTabs.set(on),
                },
                {
                  kind: 'switch',
                  key: 'general.fitTabs',
                  label: 'Tabs as wide as their names',
                  hint: 'Each tab is only as wide as its icon, name and close button need; off, every tab is the same width.',
                  words: ['width', 'wide', 'narrow', 'compact', 'fit', 'title', 'tabs'],
                  initial: true,
                  get: () => fitTabs.on,
                  set: (on) => fitTabs.set(on),
                },
                {
                  kind: 'slider',
                  key: 'general.tabPreviewDelay',
                  label: 'Tab preview delay',
                  hint: 'How long the pointer rests on a tab before its preview shows.',
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
                  label: 'Swipe between pages',
                  hint: 'Two fingers sideways on the touchpad go back and forward.',
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
                  label: 'Hidden tabs',
                  hint: 'What the web pages of another space do while it is out of sight: keep running, pause, or ask the first time.',
                  words: ['spaces', 'background', 'pause', 'sleep', 'freeze', 'audio'],
                  options: [
                    { value: 'run', label: 'Keep running' },
                    { value: 'pause', label: 'Pause' },
                    { value: 'ask', label: 'Ask' },
                  ],
                  initial: 'ask',
                  get: () => hiddenTabs.choice,
                  set: (value) => hiddenTabs.set(isHiddenTabs(value) ? value : 'ask'),
                },
                {
                  kind: 'select',
                  key: 'general.memorySaver',
                  label: 'Memory saver',
                  hint: 'Unloads web pages that have been out of sight for a while to free memory; they load again when you return.',
                  words: ['memory', 'ram', 'discard', 'sleep', 'reload', 'performance'],
                  options: [
                    { value: 'off', label: 'Off' },
                    { value: 'moderate', label: 'Moderate' },
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'maximum', label: 'Maximum' },
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
        title: 'Add task',
        fields: [
          {
            kind: 'switch',
            key: 'general.smartDates',
            label: 'Smart dates',
            hint: 'Reads dates, times and fields out of what you type into Add task, such as “tomorrow 9am”.',
            words: ['tasks', 'quick add', 'natural language', 'parse', 'todoist'],
            initial: true,
            get: () => quickAdd.smart,
            set: (on) => quickAdd.setSmart(on),
          },
          {
            kind: 'switch',
            key: 'general.undatedInToday',
            label: 'Show tasks without a start date in Today',
            hint: 'Today also lists the tasks that have no start date; off shows only those dated today or earlier.',
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
                  label: 'From any app',
                  hint: 'The Add task shortcut works even while another app is in front.',
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
              title: 'Code',
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.developerMode',
                  label: 'Developer mode',
                  hint: 'Shows terminals and the other tools for writing code.',
                  words: ['coder', 'coding', 'programmer', 'terminal', 'shell', 'ssh'],
                  initial: true,
                  get: () => modes.coder,
                  set: (on: boolean) => modes.setDeveloper(on),
                },
              ],
            },
          ]),
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: 'Hints',
              fields: [
                {
                  kind: 'switch' as const,
                  key: 'general.silentMode',
                  label: 'Silent mode',
                  hint: 'Hides the tips Orden shows while you get to know it.',
                  words: ['tips', 'hints', 'quiet', 'clean', 'onboarding'],
                  initial: DEFAULTS.silent,
                  get: () => modes.silent,
                  set: () => modes.toggleSilent(),
                },
              ],
            },
          ]),

      ...(__EVEN_PLUGIN__ ? [] : [remindersGroup()]),

      ...(!__EVEN_PLUGIN__ && isDesktop && modes.coder ? [terminalGroup()] : []),

      ...(!__EVEN_PLUGIN__ && isDesktop && ['linux', 'windows'].includes(platform())
        ? [gpuGroup()]
        : []),

      ...(!__EVEN_PLUGIN__ && isDesktop ? [privacyGroup()] : []),

      {
        title: 'Updates',
        fields: [
          ...(isDesktop
            ? ([
                {
                  kind: 'segmented',
                  label: 'Release channel',
                  words: ['beta', 'updates', 'nightly'],
                  hint: 'Stable follows released versions; Unstable follows edge builds and can break.',
                  options: [
                    { value: 'stable', label: 'Stable' },
                    { value: 'unstable', label: 'Unstable' },
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
                  label: 'Web version',
                  words: ['beta', 'updates', 'nightly', 'channel', 'edge'],
                  hint: 'Stable is the released web app; Unstable is the newest build and can break.',
                  options: [
                    { value: 'stable', label: 'Stable' },
                    { value: 'unstable', label: 'Unstable' },
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
