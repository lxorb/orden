import { ACCENTS } from './accents'
import { ICON_COLOUR_KEY } from './icons'
import { ORIENTATIONS, PAPER_SIZES } from './paper'

export const PROPERTY_CHOICES: Record<string, readonly string[]> = {
  [ICON_COLOUR_KEY]: ACCENTS.map((one) => one.id),
  paper: PAPER_SIZES,
  orientation: ORIENTATIONS,
}
