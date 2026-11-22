import { settingFieldsIn } from '@orden/contracts'
import { method, isDesktop, isMobile, platform } from '../../platform/src/api'
import { usageChoice } from '../../usage/src/api'
import { DEFAULTS, KEEP_MONTH, KEEP_YEAR, modes, REMIND_BEFORE } from '../../modes/src/api'
import { account } from '../../accounts/src/api'
import { protectionOn, turnProtection } from '../../sharing/src/api'
import { DEFAULT_RELOCK, NEVER, RELOCK_MINUTES, unlocks } from '../../protect/src/api'
import { recovery } from '../../history/src/api'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from '../../snapshots/src/api'
import { hasTray, residency } from '../../quitting/src/api'
import { tabCycle } from '../../tab-cycle/src/api'
import { fitTabs, iconTabs, PREVIEW_DELAY, previewDelay, unloadTabs } from '../../tab-strip/src/api'
import { swipeChoice } from '../../back-swipe/src/api'
import { asChannel, switchWebChannel, updates, webChannel } from '../../updates/src/api'
import type { Field, Group, Pane } from './fields'
import { gpu } from './gpu.svelte'
import { versionField } from './version.svelte'
import { keptForGood } from '../../kept-for-good/src/api'

export function relockField(): Field {
  return {
    kind: 'select',
    key: 'general.relockAfter',
    label: 'Lock again after',
    hint: 'How long Orden may be in the background before what you protected locks again.',
    words: ['protect', 'lock', 'password', 'timeout'],
    options: RELOCK_MINUTES.map((minutes) => ({
      value: String(minutes),
      label: minutes === NEVER ? 'Only when Orden closes' : minutes === 0 ? 'Right away' : `${minutes} min`,
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
      ...settingFieldsIn('general', 'Privacy'),
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
function reminderFields(): Field[] {
  const exact = method('exactAlarms')
  const ask = method('askExactAlarms')
  return [
    {
      kind: 'select',
      key: 'general.remindBefore',
      label: 'Reminders',
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
  ]
}
function accountVersionsField(): Field {
  return {
    kind: 'select',
    key: 'sync.keepVersions',
    label: 'Keep versions on the account for',
    words: ['history', 'backup', 'sync', 'account', 'month', 'year'],
    options: [
      { value: String(KEEP_MONTH), label: 'A month' },
      { value: String(KEEP_YEAR), label: 'A year' },
    ],
    initial: String(DEFAULTS.keepVersions),
    get: () => String(modes.keepVersions),
    set: (value) => modes.setKeepVersions(Number(value)),
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
        title: '',
        fields: [
          {
            kind: 'switch',
            key: 'general.protection',
            label: 'Use protection',
            hint: 'Adds Protect to menus, to keep notes, folders and spaces behind a password or this device’s lock.',
            words: ['protect', 'lock', 'password', 'private', 'hide'],
            initial: false,
            get: () => protectionOn(),
            set: (on) => void turnProtection(on),
          },
          ...(protectionOn() ? [relockField()] : []),
          {
            kind: 'switch',
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
      {
        title: 'Version history',
        fields: [
          {
            kind: 'select',
            key: 'general.keepVersionEvery',
            label: 'Keep a version every',
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
            options: KEEP_DAYS.map((days) => ({
              value: String(days),
              label: days === 1 ? '1 day' : `${days} days`,
            })),
            initial: String(DEFAULT_DAYS),
            get: () => String(recovery.days),
            set: (value) => recovery.setDays(Number(value)),
          },
          ...(account.user ? [accountVersionsField()] : []),
        ],
      },
      ...(keptForGood.able ? [keptGroup()] : []),
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
                  words: ['icon', 'compact', 'pinned', 'title', 'tabs'],
                  initial: false,
                  get: () => iconTabs.on,
                  set: (on) => iconTabs.set(on),
                },
                {
                  kind: 'switch',
                  key: 'general.fitTabs',
                  label: 'Tabs as wide as their names',
                  words: ['width', 'wide', 'narrow', 'compact', 'fit', 'title', 'tabs'],
                  initial: true,
                  get: () => fitTabs.on,
                  set: (on) => fitTabs.set(on),
                },
                {
                  kind: 'slider',
                  key: 'general.tabPreviewDelay',
                  label: 'Tab preview delay',
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
                  words: ['swipe', 'gesture', 'touchpad', 'trackpad', 'back', 'forward', 'history'],
                  initial: true,
                  get: () => swipeChoice.on,
                  set: (on) => swipeChoice.set(on),
                },
              ] satisfies Field[])),
          ...settingFieldsIn('general', 'Tabs'),
        ],
      },
      {
        title: 'Tasks',
        fields: [...settingFieldsIn('general', 'Add task'), ...reminderFields()],
      },
      ...(isDesktop && ['linux', 'windows'].includes(platform()) ? [gpuGroup()] : []),
      ...(isDesktop ? [privacyGroup()] : []),
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
          ...(webChannel
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
