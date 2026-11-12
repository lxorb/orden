import katex from 'katex/dist/katex.min.css?raw'
import base from './base.css?raw'
import note from './document.css?raw'
import exported from './export.css?raw'
import tokens from './tokens.css?raw'

export const themeCss = [tokens, base].join('\n')

export const tokensCss = tokens

export const exportCss = [note, exported].join('\n')

export const proseCss = [base, note].join('\n')

export const katexCss = katex
