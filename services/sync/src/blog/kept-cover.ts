import {
  type Cover,
  COVER_KEY,
  COVER_POSITION_KEY,
  coverPosition,
  coverSrc,
} from '@orden/markdown/cover'
import { metaFromText } from '@orden/sync-core/meta'

export function keptCover(meta: string | null | undefined): Cover | null {
  const kept = metaFromText(meta)
  const said = kept?.[COVER_KEY]
  const src = said ? coverSrc(said) : ''
  return src ? { src, position: coverPosition(kept?.[COVER_POSITION_KEY]) } : null
}
