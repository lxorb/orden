export const HEADING_LEVEL: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
}

export const headingLevel = (name: string): number | null => HEADING_LEVEL[name] ?? null

export { headingText } from '@orden/markdown/links'
