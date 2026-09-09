/** What the app needs to know about blocks: which one a press landed in, and
 *  the three things a menu row does to it. */

export { blocksFor, blockTarget, deleteBlocks, duplicateBlocks } from './commands'
export { blockAt, type BlockKind, type BlockSpan } from './span'
