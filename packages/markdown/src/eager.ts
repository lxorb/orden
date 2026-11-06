import * as emoji from 'node-emoji'
import { useEmoji, useMaths } from './engines'
import katex from './maths'

useMaths(katex)
useEmoji(emoji)
