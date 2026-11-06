import { describe, expect, test } from 'vitest'
import { accountBrand, providerBrand } from './provider-brand'

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

describe('whoever serves an account', () => {
  const server = (baseUrl: string, name = '') => accountBrand({ kind: 'compatible', baseUrl, name })

  test('is its kind for the keys, the plans and the programs', () => {
    expect(accountBrand({ kind: 'anthropic', name: '' })).toBe('claude')
    expect(accountBrand({ kind: 'claude-code', name: 'Work' })).toBe('claude')
    expect(accountBrand({ kind: 'openai', name: '' })).toBe('openai')
    expect(accountBrand({ kind: 'chatgpt', name: '' })).toBe('openai')
    expect(accountBrand({ kind: 'codex', name: '' })).toBe('openai')
  })

  test('is a compatible server by where it is', () => {
    expect(server('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(server('https://api.mistral.ai/v1', 'Work')).toBe('mistralai')
    expect(server('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('googlegemini')
    expect(server('https://api.deepseek.com')).toBe('deepseek')
    expect(server('https://api.perplexity.ai')).toBe('perplexity')
    expect(server('https://router.huggingface.co/v1')).toBe('huggingface')
    expect(server('https://api.moonshot.ai/v1')).toBe('moonshotai')
  })

  test('and by the port of a program on the reader’s own machine', () => {
    expect(server('http://localhost:11434')).toBe('ollama')
    expect(server('http://127.0.0.1:11434/v1', 'My models')).toBe('ollama')
    expect(server('http://localhost:1234/v1')).toBe('lmstudio')
  })

  test('and by what the reader called it where the address says nothing', () => {
    expect(server('http://10.0.0.5:8080/v1', 'Ollama on the desktop')).toBe('ollama')
    expect(server('http://localhost:9000', 'LM Studio')).toBe('lmstudio')
    expect(server('http://localhost:8000', 'vLLM')).toBe('vllm')
    expect(server('', 'Mistral')).toBe('mistralai')
  })

  test('and is no one where neither says', () => {
    expect(server('http://10.0.0.5:8080/v1', 'Work gateway')).toBeNull()
    expect(accountBrand({ kind: 'compatible', name: '' })).toBeNull()
  })
})
