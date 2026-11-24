import { String, Array, Effect, Iterable, Predicate, Result, Schema, Stream } from 'effect'
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

interface TokenizedPrompt {
  stops: string[]
  tokens: number[]
}
const FormattedChat = Schema.Struct({ prompt: Schema.String })
const ChatProperties = Schema.Struct({ bos_token: Schema.String })
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- llama.cpp sends untrusted JSON for the rendered prompt.
const decodeFormattedChat = Schema.decodeUnknownEffect(FormattedChat)
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- llama.cpp sends untrusted JSON for its token properties.
const decodeChatProperties = Schema.decodeUnknownEffect(ChatProperties)

const singleToken = (tokens: Readonly<number[]>): Effect.Effect<number, TranslationError> => {
  const [token, ...extra] = tokens
  return Predicate.isNullish(token) || Array.isArrayNonEmpty(extra)
    ? Effect.fail(invalidMetadata())
    : Effect.succeed(token)
}

const tokenizePlamo = (server: LocalServer, prompt: Prompt.Prompt): Effect.Effect<TokenizedPrompt, TranslationError> =>
  Effect.gen(function* () {
    const bos = yield* tokenize(server, '<|plamo:bos|>', { trusted: true })
    const tag = yield* tokenize(server, '<|plamo:tag|>', { trusted: true })
    const bosToken = yield* singleToken(bos)
    const tagToken = yield* singleToken(tag)
    if (bosToken === tagToken) {
      return yield* Effect.fail(invalidMetadata())
    }
    const parts = yield* Effect.forEach(prompt.content, (message) =>
      tokenize(server, textContent(message), { trusted: message.role !== 'user' }),
    )
    return { stops: ['<|plamo:tag|>', '<|plamo:bos|>'], tokens: Array.appendAll(bos, Array.flatten(parts)) }
  })

const unusedMarker = (source: string): string => {
  const matches = String.matchAll(/GLOSSSHIFT_USER_PLACEHOLDER_*/gu)(source)
  const longest = Iterable.reduce(matches, '', (current, [match]) =>
    Predicate.isNotNullish(match) && match.length > current.length ? match : current,
  )
  return String.isEmpty(longest) ? 'GLOSSSHIFT_USER_PLACEHOLDER' : `${longest}_`
}

const formatChat = (
  server: LocalServer,
  prompt: Prompt.Prompt,
  marker: string,
): Effect.Effect<string, TranslationError> =>
  serverJson(
    server,
    {
      body: {
        add_generation_prompt: true,
        messages: Array.map(prompt.content, (message) => ({
          content: message.role === 'user' ? marker : textContent(message),
          role: message.role,
        })),
      },
      endpoint: '/apply-template',
    },
    decodeFormattedChat,
  ).pipe(Effect.map(({ prompt: rendered }) => rendered))

const withBos = (server: LocalServer, head: number[]): Effect.Effect<number[], TranslationError> =>
  Effect.gen(function* () {
    const properties = yield* serverJson(server, { endpoint: '/props' }, decodeChatProperties)
    if (String.isEmpty(properties.bos_token)) {
      return head
    }
    const bos = yield* tokenize(server, properties.bos_token, { trusted: true })
    const automatic = yield* tokenize(server, '', { addSpecial: true, trusted: false })
    const token = yield* singleToken(bos)
    const [first] = head
    return Array.contains(automatic, token) && first !== token ? Array.prepend(head, token) : head
  })

const chatSource = (prompt: Prompt.Prompt): Effect.Effect<string, TranslationError> => {
  const users = Array.filter(prompt.content, (message) => message.role === 'user')
  const [user, ...extra] = users
  const unsupported = Array.some(prompt.content, (message) => message.role !== 'system' && message.role !== 'user')
  if (Predicate.isNullish(user) || Array.isArrayNonEmpty(extra) || unsupported) {
    return Effect.fail(invalidMetadata())
  }
  return Effect.succeed(textContent(user))
}

const chatTemplate = (
  server: LocalServer,
  prompt: Prompt.Prompt,
): Effect.Effect<Readonly<{ before: string; after: string }>, TranslationError> =>
  Effect.gen(function* () {
    // Give the publisher template a marker absent from all message content.
    const text = Array.join(Array.map(prompt.content, textContent), '')
    const marker = unusedMarker(text)
    const formatted = yield* formatChat(server, prompt, marker)
    const [before, after, ...remaining] = formatted.split(marker)
    if (Predicate.isNullish(before) || Predicate.isNullish(after) || Array.isArrayNonEmpty(remaining)) {
      return yield* Effect.fail(invalidMetadata())
    }
    return { after, before }
  })

const tokenizeChat = (server: LocalServer, prompt: Prompt.Prompt): Effect.Effect<TokenizedPrompt, TranslationError> =>
  Effect.gen(function* () {
    const sourceText = yield* chatSource(prompt)
    const { after, before } = yield* chatTemplate(server, prompt)
    const prelude = yield* tokenize(server, before, { trusted: true })
    const head = yield* withBos(server, prelude)
    const source = yield* tokenize(server, sourceText, { trusted: false })
    const tail = yield* tokenize(server, after, { trusted: true })
    const tokens = Array.appendAll(head, source)
    return { stops: [], tokens: Array.appendAll(tokens, tail) }
  })

/**
 * Parse publisher tokens and trusted template text as special tokens.
 *
 * @param {LocalServer} server Authenticated local inference server.
 * @param {LocalConfig} config Selected publisher prompt format.
 * @param {Prompt.Prompt} prompt Messages containing the source text.
 * @returns {Effect.Effect} Model tokens with the publisher's stopping sequences.
 */
export const tokenizePrompt = (
  server: LocalServer,
  config: LocalConfig,
  prompt: Prompt.Prompt,
): Effect.Effect<TokenizedPrompt, TranslationError> =>
  config.model.prompt === 'plamo' ? tokenizePlamo(server, prompt) : tokenizeChat(server, prompt)

export const generate = (
  server: LocalServer,
  config: LocalConfig,
  prompt: Prompt.Prompt,
): Stream.Stream<string, TranslationError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* tokenizePrompt(server, config, prompt)
      if (input.tokens.length >= config.contextSize) {
        return yield* Effect.fail(
          new TranslationError({
            code: 'ContextTooLong',
            message: 'The source text exceeds the local model context. Translate a smaller section.',
          }),
        )
      }
      const abort = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller) => Effect.sync(() => controller.abort()),
      )
      const budget = Math.min(config.maxTokens, config.contextSize - input.tokens.length)
      const iterator = completion(server, { budget, stops: input.stops, tokens: input.tokens }, abort.signal)
      const iterable: AsyncIterable<string> = {
        [Symbol.asyncIterator]: () => ({
          next: () => iterator.next(),
          return: () => {
            abort.abort()
            // oxlint-disable-next-line unicorn/no-useless-undefined -- AsyncGenerator.return requires the completion value even when the generator returns void.
            return iterator.return(undefined)
          },
        }),
      }
      return Stream.fromAsyncIterable(iterable, (cause) =>
        cause instanceof TranslationError ? cause : inferenceFailed(),
      )
    }),
  )
