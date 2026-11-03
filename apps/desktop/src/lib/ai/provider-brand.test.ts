import { describe, expect, test } from 'vitest'
import { providerBrand } from './provider-brand'

/** #1089: a chat's row wears the logo of whose model it talks to. */
describe('whose model a chat talks to', () => {
  test('is said by the model where its name says it', () => {
    expect(providerBrand('anthropic', 'claude-sonnet-4-5')).toBe('claude')
    expect(providerBrand('compatible', 'anthropic/claude-opus-4')).toBe('claude')
    expect(providerBrand('openai', 'gpt-5')).toBe('openai')
    expect(providerBrand('compatible', 'openai/o3-mini')).toBe('openai')
    expect(providerBrand('compatible', 'google/gemini-2.5-pro')).toBe('googlegemini')
    expect(providerBrand('compatible', 'meta-llama/llama-3.3-70b')).toBe('meta')
    expect(providerBrand('compatible', 'deepseek-chat')).toBe('deepseek')
  })

  /** Claude Code's and Codex's sessions name a model the program picked, or none. */
  test('and by the provider where the model says nothing', () => {
    expect(providerBrand('claude-code', 'default')).toBe('claude')
    expect(providerBrand('codex', '')).toBe('openai')
    expect(providerBrand('chatgpt', 'auto')).toBe('openai')
  })

  test('and is no one where neither says', () => {
    expect(providerBrand('compatible', 'my-own-model')).toBeNull()
    expect(providerBrand(null, '')).toBeNull()
  })
})
