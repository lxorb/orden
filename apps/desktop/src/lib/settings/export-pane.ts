import { t } from '../i18n.svelte'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, PAPER_SIZES } from '../paper'
import { settings } from '../settings.svelte'
import type { Pane } from './fields'

export function exportPane(): Pane {
  return {
    id: 'export',
    label: t('Export'),
    groups: [
      {
        title: t('Page'),
        fields: [
          {
            kind: 'select',
            key: 'export.paper',
            label: t('Paper'),
            hint: t('The paper size of a PDF or a print.'),
            options: PAPER_SIZES.map((size) => ({ value: size, label: size })),
            get: () => settings.page.paper,
            set: (value) => settings.setPage({ paper: value as never }),
          },
          {
            kind: 'select',
            key: 'export.orientation',
            label: t('Orientation'),
            hint: t('Whether pages are upright or on their side.'),
            options: ORIENTATIONS.map((one) => ({ value: one, label: t(one) })),
            get: () => settings.page.orientation,
            set: (value) => settings.setPage({ orientation: value as never }),
          },
          {
            kind: 'text',
            key: 'export.margin',
            label: t('Margin'),
            hint: t('The space around the edge of each page, such as 20mm or 1in.'),
            placeholder: DEFAULT_PAGE_SETUP.margin,
            live: true,
            get: () => settings.page.margin,
            set: (value) => settings.setPage({ margin: value }),
          },
          {
            kind: 'text',
            key: 'export.header',
            label: t('Header'),
            hint: t('Text at the top of every page; ${title}, ${date} and ${year} are filled in.'),
            placeholder: '${title}',
            live: true,
            get: () => settings.page.header,
            set: (value) => settings.setPage({ header: value }),
          },
          {
            kind: 'text',
            key: 'export.footer',
            label: t('Footer'),
            hint: t(
              'Text at the bottom of every page; ${title}, ${date} and ${year} are filled in.',
            ),
            placeholder: '${date}',
            live: true,
            get: () => settings.page.footer,
            set: (value) => settings.setPage({ footer: value }),
          },
          {
            kind: 'select',
            key: 'export.appearance',
            label: t('Appearance'),
            hint: t('Whether an export is light, dark, or as the app is now.'),
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
