import { SvelteMap } from 'svelte/reactivity'
import type { Machine } from '../terminal/source'

export const marks = new SvelteMap<string, Machine | null>()
