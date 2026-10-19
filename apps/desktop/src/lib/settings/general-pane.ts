import { panelDrawable } from '../even/panel-words'
import { CATALOGUES_URL, i18n, plural, t } from '../i18n.svelte'
import { languageOptions, machineSaid } from '../language-options'
import { method } from '../mobile/bridge'
import { DEFAULTS, modes, REMIND_BEFORE } from '../modes.svelte'
import { isPlugin } from '../plugin'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from '../recovery'
import { recovery } from '../recovery.svelte'
import { hasTray, residency } from '../reminders/residency.svelte'
import { chatsGroups } from '../chats-settings'
import { tabCycle } from '../tab-cycle.svelte'
import { isDesktop, isMobile, platform } from '../tauri'
import { swipeChoice } from '../back-swipe/choice.svelte'
import { BY_ID } from '../shortcuts/registry'
import { asWarning, shellName, shells, SIZES } from '../terminal/shells.svelte'
import { bothName } from '../terminal/two-ways'
import { asChannel } from '../updater'
import { updates } from '../updates.svelte'
import { pages } from '../web-tab/pages.svelte'
import { isSaver } from '../web-tab/resting'
import { saver } from '../web-tab/saver.svelte'
import { hiddenTabs } from '../workspace/hidden-tabs.svelte'
import { quickAdd } from '../quick-add/asked.svelte'
import { isHiddenTabs } from '../workspace/sets'
import { projectsOf, setProjects } from '../rows/projects'
import { workspace } from '../workspace.svelte'
import type { Field, Group, Pane } from './fields'

/** Whose a key that is both the app's and the shell's is, one row each: asked every
 *  time, the app's command, or the shell's character. A row for every key somebody has
 *  answered the question for - any app command on a key a shell reads can be one (#426)
 *  - and putting it back to asking takes the row away. On a Mac none ever is: Cmd never
 *  reaches a shell. See terminal/two-ways.ts. */
function twoWayFields(): Field[] {
  return Object.keys(shells.ways)
    .filter((command) => BY_ID.has(command))
    .map((command): Field => ({
      kind: 'select',
      label: bothName(command),
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

/** The terminal's settings. The shells are asked for as the pane is drawn, which is
 *  the first time this list is needed; the row fills in when they arrive. */
function terminalGroup(): Group {
  void shells.ask()

  return {
    title: t('Terminal'),
    fields: [
      {
        kind: 'select',
        label: t('Shell'),
        options: shells.list.map((one) => ({ value: one.id, label: shellName(one) })),
        get: () => shells.chosen?.id ?? '',
        set: (id) => shells.choose(id),
      },
      {
        kind: 'slider',
        label: t('Text size'),
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
        label: t('Restore history'),
        words: ['scrollback', 'session', 'restart', 'privacy'],
        initial: true,
        get: () => shells.restoring,
        set: (on) => shells.setRestoring(on),
      },
      {
        kind: 'select',
        label: t('Warn before quitting'),
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

/** When a task reminds of itself, and what keeps the reminders ringing: the tray on a
 *  desktop that has one, the exact alarms on a phone. One line on Linux, where nothing
 *  rings with nib closed. See docs/tasks.md 5.10. */
/** The folders at the top of a space a Tasks panel can take its projects from, the one
 *  in force among them even before it is made. */
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
        label: t('Automatic'),
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
              label: t('Stay in the tray'),
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
              words: ['alarm', 'reminder', 'exact', 'battery'],
              get: () => exact(),
              set: () => ask(),
            },
          ] satisfies Field[])
        : []),
    ],
  }
}

/** What the Language group says under its row, where there is anything to say.
 *
 *  One caption, because two sentences about the same choice are one caption; the link
 *  is the catalogues folder either way, since that is where a correction goes and a
 *  reader who cannot read the panel may well want to fix the words too. */
function caption(): { caption?: { text: string; url: string } } {
  const said = [
    i18n.machine ? machineSaid() : '',
    (isPlugin() || modes.glassesSeen) && !panelDrawable() ? t('The glasses show English.') : '',
  ].filter(Boolean)

  if (!said.length) return {}
  return { caption: { text: said.join(' '), url: CATALOGUES_URL } }
}

/** Settings › General; see `preferences` in ../preferences.ts. */
export function generalPane(): Pane {
  return {
    id: 'general',
    label: t('General'),
    groups: [
      {
        // A note being written in is kept every so often on top of the words
        // each sitting began with, so an edit that went wrong is not the end of
        // the story; History is where the versions are.
        title: t('Recovery'),
        fields: [
          {
            kind: 'select',
            label: t('Keep a version every'),
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
            label: t('Keep versions for'),
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
      {
        // Chrome's order is the default, and VS Code's is the option: the tab
        // used last, and further back for each press while Ctrl is held. See
        // tab-cycle.svelte.ts.
        title: t('Tabs'),
        fields: [
          {
            kind: 'switch',
            label: t('Ctrl+Tab in order of use'),
            words: ['tabs', 'recent', 'switcher'],
            initial: false,
            get: () => tabCycle.byUse,
            set: (on) => tabCycle.setByUse(on),
          },
          // Two fingers sideways for back and forward, as in every browser; off for a
          // hand that keeps doing it by accident. Not on a phone, whose side of the
          // screen is the system's own back. See back-swipe/swipes.ts.
          ...(isMobile
            ? []
            : ([
                {
                  kind: 'switch',
                  label: t('Swipe between pages'),
                  words: ['swipe', 'gesture', 'touchpad', 'trackpad', 'back', 'forward', 'history'],
                  initial: true,
                  get: () => swipeChoice.on,
                  set: (on) => swipeChoice.set(on),
                },
              ] satisfies Field[])),
          // What a space's own tabs do out of sight: the pages a desktop runs, which a
          // phone and a browser tab do not. See workspace/hidden-tabs.svelte.ts.
          ...(isDesktop
            ? ([
                {
                  kind: 'segmented',
                  label: t('Hidden tabs'),
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
                // Off, so no page is ever closed for memory unless somebody asks; out of
                // sight it is frozen instead. See web-tab/resting.ts.
                {
                  kind: 'select',
                  label: t('Memory saver'),
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
        // Quick add: whether its words are read as dates and fields at all (Todoist's
        // smart date switch), and whether its key reaches past the window. See
        // quick-add/asked.svelte.ts and docs/tasks.md 5.6.
        title: t('Add task'),
        fields: [
          {
            kind: 'switch',
            label: t('Smart dates'),
            words: ['tasks', 'quick add', 'natural language', 'parse', 'todoist'],
            initial: true,
            get: () => quickAdd.smart,
            set: (on) => quickAdd.setSmart(on),
          },
          // Which folder of the open space the Tasks panel lists as its projects
          // (rows/projects.ts): any folder at its top, Projects where none was chosen.
          ...(workspace.activeSpace
            ? ([
                {
                  kind: 'select',
                  label: t('Projects folder'),
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
          // Whether Today holds the tasks with no start date, as begun; off is Today as
          // Todoist has it. On the account (modes.svelte.ts, docs/tasks.md 5.1.1).
          {
            kind: 'switch',
            label: t('Show tasks without a start date in Today'),
            words: ['tasks', 'today', 'start date', 'undated', 'no date', 'todoist'],
            initial: DEFAULTS.undatedInToday,
            get: () => modes.undatedInToday,
            set: (on) => modes.setUndatedInToday(on),
          },
          ...(isDesktop && !isMobile
            ? ([
                {
                  kind: 'switch',
                  label: t('From any app'),
                  words: ['tasks', 'quick add', 'global', 'hotkey', 'shortcut', 'system'],
                  initial: true,
                  get: () => quickAdd.anywhere,
                  set: (on) => quickAdd.setAnywhere(on),
                },
              ] satisfies Field[])
            : []),
        ],
      },
      // Silent mode turns the hints off; see hints.svelte.ts. The glasses have none.
      ...(__EVEN_PLUGIN__
        ? []
        : [
            {
              title: t('Hints'),
              fields: [
                {
                  kind: 'switch' as const,
                  label: t('Silent mode'),
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
        // Two things can be worth saying about a language, and both are one line.
        //
        // Most of the catalogues were written in one pass and never read through.
        // Saying so is the honest part; the folder they live in is the useful part,
        // because the reader who can see the wrong word is the only person who can
        // put it right.
        //
        // And the glasses have one font baked into the firmware, with no Devanagari,
        // Arabic, Thai, Burmese or Ethiopic in it at all - so for a reader in one of
        // those scripts the panel is in English however the app is set. Said here,
        // where the choice is made, and only to somebody who has a pair: it is the
        // one place a reader could act on it, and noise to everybody else. The rule
        // itself is `panelDrawable`; see even/panel-words.ts.
        ...caption(),
        fields: [
          {
            kind: 'select',
            label: t('Language'),
            // Each row says for itself whether its catalogue was read through;
            // see language-options.ts.
            options: languageOptions(),
            get: () => i18n.choice,
            set: (value) => i18n.select(value),
          },
        ],
      },

      // The automatic reminder, and the tray or the alarms that keep reminders ringing;
      // never the glasses' plugin, which rings nothing.
      ...(__EVEN_PLUGIN__ ? [] : [remindersGroup()]),

      // What pings for every chat, where a chat can ping at all: a desktop and the
      // browser, never a phone, whose push is off (docs/chats.md decision 7.4). None in
      // the glasses' plugin, whose twin of the module has no chats; see
      // chats-settings.even.ts.
      ...(isMobile ? [] : chatsGroups()),

      // Which shell a new terminal opens, how large its type is and whether its lines
      // come back after a restart: this machine's, like the release channel below,
      // because a shell is a program on one computer and its screen is nobody else's.
      // Only a desktop has a terminal; see docs/terminal.md.
      ...(!__EVEN_PLUGIN__ && isDesktop ? [terminalGroup()] : []),

      // Only the desktop app installs anything: a page is the new version the
      // moment it is reloaded, and a phone app is the store's business. So the
      // row is not there at all rather than there and answering nothing.
      //
      // The choice stays on this machine, since it is about this machine: one
      // laptop can run the build of main while the desktop stays on the
      // releases. See updates.svelte.ts.
      ...(isDesktop
        ? ([
            {
              title: t('Updates'),
              fields: [
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
              ],
            },
          ] satisfies Group[])
        : []),
    ],
  }
}
