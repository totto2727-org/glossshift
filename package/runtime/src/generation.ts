import { Array, Effect, Result, Schema, Stream } from 'effect'
import type { Prompt } from 'effect/ai'

import { TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { completion, inferenceFailed, invalidMetadata, serverJson, tokenize } from './server-api.ts'
import type { LocalServer } from './server-api.ts'

const textContent = (message: Prompt.Message): string =>
  message.role === 'system'
    ? message.content
    : Array.join(
        Array.filterMap(message.content, (part: Prompt.Part) =>
          part.type === 'text' ? Result.succeed(part.text) : Result.failVoid,
        ),
        '',
      )

/** Only publisher tokens and the trusted template are parsed as special tokens. */
export const tokenizePrompt = (server: LocalServer, config: LocalConfig, prompt: Prompt.Prompt) =>
  Effect.gen(function* () {
    if (config.model.prompt === 'plamo') {
      const bos = yield* tokenize(server, '<|plamo:bos|>', true)
      const tag = yield* tokenize(server, '<|plamo:tag|>', true)
      if (bos.length !== 1 || tag.length !== 1 || bos[0] === tag[0]) return yield* Effect.fail(invalidMetadata())
      const parts = yield* Effect.forEach(prompt.content, (message) =>
        tokenize(server, textContent(message), message.role !== 'user'),
      )
      return { tokens: Array.appendAll(bos, Array.flatten(parts)), stops: ['<|plamo:tag|>', '<|plamo:bos|>'] }
    }
    // Ask the publisher template to format inert placeholders, never raw user content.
    const userText = Array.join(Array.map(prompt.content, textContent), '')
    let marker = 'GLOSSSHIFT_USER_PLACEHOLDER'
    while (userText.includes(marker)) marker += '_'
    const users = Array.filter(prompt.content, (message) => message.role === 'user')
    if (
      users.length !== 1 ||
      Array.some(prompt.content, (message) => message.role !== 'system' && message.role !== 'user')
    )
      return yield* Effect.fail(invalidMetadata())
    const formatted = yield* serverJson(
      server,
      '/apply-template',
      {
        messages: Array.map(prompt.content, (message) => ({
          role: message.role,
          content: message.role === 'user' ? marker : textContent(message),
        })),
        add_generation_prompt: true,
      },
      Schema.Struct({ prompt: Schema.String }),
    )
    const split = formatted.prompt.split(marker)
    if (split.length !== 2) return yield* Effect.fail(invalidMetadata())
    let head = yield* tokenize(server, split[0]!, true)
    const properties = yield* serverJson(server, '/props', undefined, Schema.Struct({ bos_token: Schema.String }))
    if (properties.bos_token !== '') {
      const bos = yield* tokenize(server, properties.bos_token, true)
      const automatic = yield* tokenize(server, '', false, true)
      if (bos.length !== 1) return yield* Effect.fail(invalidMetadata())
      if (Array.contains(automatic, bos[0]!) && head[0] !== bos[0]) head = Array.prepend(head, bos[0]!)
    }
    const source = yield* tokenize(server, textContent(users[0]!), false)
    const tail = yield* tokenize(server, split[1]!, true)
    return { tokens: Array.appendAll(Array.appendAll(head, source), tail), stops: [] as string[] }
  })

export const generate = (
  server: LocalServer,
  config: LocalConfig,
  prompt: Prompt.Prompt,
): Stream.Stream<string, TranslationError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* tokenizePrompt(server, config, prompt)
      if (input.tokens.length >= config.contextSize)
        return yield* Effect.fail(
          new TranslationError({
            code: 'ContextTooLong',
            message: 'The source text exceeds the local model context. Translate a smaller section.',
          }),
        )
      const abort = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller) => Effect.sync(() => controller.abort()),
      )
      const budget = Math.min(config.maxTokens, config.contextSize - input.tokens.length)
      const iterator = completion(server, input.tokens, budget, input.stops, abort.signal)
      const iterable: AsyncIterable<string> = {
        [Symbol.asyncIterator]: () => ({
          next: () => iterator.next(),
          return: () => {
            abort.abort()
            return iterator.return(undefined)
          },
        }),
      }
      return Stream.fromAsyncIterable(iterable, (error) =>
        error instanceof TranslationError ? error : inferenceFailed(),
      )
    }),
  )
