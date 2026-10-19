import { t } from '../i18n.svelte'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, PAPER_SIZES } from '../paper'
import { settings } from '../settings.svelte'
import type { Pane } from './fields'

/** Settings › Export; see `preferences` in ../preferences.ts. */
export function exportPane(): Pane {
  return {
    // The page an export is laid out on. The ways of exporting are beside it on
    // the pane and are commands rather than settings; see `exportExtras` in
    // SettingsPanel.svelte.
    //
    // None of these says what it started as, so the pane offers no reset: a
    // margin somebody typed is a decision about their printer, and one button
    // that quietly replaced six of those is not worth having.
    id: 'export',
    label: t('Export'),
    groups: [
      {
        title: t('Page'),
        fields: [
          {
            kind: 'select',
            label: t('Paper'),
            options: PAPER_SIZES.map((size) => ({ value: size, label: size })),
            get: () => settings.page.paper,
            set: (value) => settings.setPage({ paper: value as never }),
          },
          {
            kind: 'select',
            label: t('Orientation'),
            options: ORIENTATIONS.map((one) => ({ value: one, label: t(one) })),
            get: () => settings.page.orientation,
            set: (value) => settings.setPage({ orientation: value as never }),
          },
          {
            kind: 'text',
            label: t('Margin'),
            placeholder: DEFAULT_PAGE_SETUP.margin,
            live: true,
            get: () => settings.page.margin,
            set: (value) => settings.setPage({ margin: value }),
          },
          // Running text on every sheet. `${title}`, `${date}` and `${year}` are
          // filled in; the placeholder shows the shape.
          {
            kind: 'text',
            label: t('Header'),
            placeholder: '${title}',
            live: true,
            get: () => settings.page.header,
            set: (value) => settings.setPage({ header: value }),
          },
          {
            kind: 'text',
            label: t('Footer'),
            placeholder: '${date}',
            live: true,
            get: () => settings.page.footer,
            set: (value) => settings.setPage({ footer: value }),
          },
          {
            kind: 'select',
            label: t('Appearance'),
            options: [
              { value: 'light', label: t('Light') },
              { value: 'dark', label: t('Dark') },
              { value: 'app', label: t('Match the app') },
            ],
            get: () => settings.exportAppearance,
            set: (value) => settings.setExportAppearance(value as never),
          },
        ],
      },
    ],
  }
}
