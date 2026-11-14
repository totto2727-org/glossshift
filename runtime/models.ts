import { String } from 'effect'

import type { ModelSource } from './config.ts'

const supportedLanguages = String.split(
  'ar az be bg bn ca ceb de en es et eu fa fr gu he hi hr hu hy id it ja jv ka kk km ko lt lv ml mr ms my ne nl pa pl ru si sk sl sr sw ta te th tl ur uz vi zh-hans zh-hant',
  ' ',
)

// Publisher config.json files declare max_position_embeddings = 262144 for all four sizes.
// https://huggingface.co/pfnet/plamo-3-translate-{0.8b,2b,8b,31b}/raw/main/config.json
// Translation training length (32768) is not the architecture's context ceiling.
export const modelPresets = {
  'plamo-3-translate-0.8b': {
    model: {
      uri: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/1cf96ae02133958a20074bfdfab76517bb737d00/plamo-3-translate-0.8b-Q4_K_M.gguf',
      sha256: '70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6',
      prompt: 'plamo',
      supportedLanguages,
    } satisfies ModelSource,
    contextSize: 262144,
    maxTokens: 262144,
    contextLimit: 262144,
  },
  'plamo-3-translate-2b': {
    model: {
      uri: 'https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/resolve/4f672106b847200bfdc0f6af6c321cd94eba1aed/plamo-3-translate-2b-Q4_K_M.gguf',
      sha256: '1ffd9073afcc70e35ccc942428aa2b73d7aa2b9ea779bf504b775369e0276c13',
      prompt: 'plamo',
      supportedLanguages,
    } satisfies ModelSource,
    contextSize: 262144,
    maxTokens: 262144,
    contextLimit: 262144,
  },
  'plamo-3-translate-8b': {
    model: {
      uri: 'https://huggingface.co/pfnet/plamo-3-translate-8b-GGUF/resolve/c67efa4eefdc14d3c97bf8f4f35ee58e2ecd2f42/plamo-3-translate-8b-Q4_K_M.gguf',
      sha256: '94e5d3f91b421f7c8900ddaac27b11a19f7441426c954bbb25a2fd60a1640187',
      prompt: 'plamo',
      supportedLanguages,
    } satisfies ModelSource,
    contextSize: 262144,
    maxTokens: 262144,
    contextLimit: 262144,
  },
  'plamo-3-translate-31b': {
    model: {
      uri: 'https://huggingface.co/pfnet/plamo-3-translate-31b-GGUF/resolve/8b797b290907c84403877cb9d03150929f10b467/plamo-3-translate-31b-Q4_K_M.gguf',
      sha256: '47788c3eb71b830919a8454022381de943a43edfab65dad9e742997028d1f9df',
      prompt: 'plamo',
      supportedLanguages,
    } satisfies ModelSource,
    contextSize: 262144,
    maxTokens: 262144,
    contextLimit: 262144,
  },
}

export type ModelId = keyof typeof modelPresets
export const defaultModelId: ModelId = 'plamo-3-translate-0.8b'
