import { Array, Effect, Result, Stream } from 'effect'
import type { Prompt } from 'effect/ai'
import { LlamaText, resolveChatWrapper, SpecialTokensText } from 'node-llama-cpp'
import type { ChatHistoryItem, LlamaModel, Token } from 'node-llama-cpp'

import { TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { scopedNative } from './model.ts'

const inferenceFailed = () =>
  new TranslationError({
    code: 'InferenceFailed',
    message: 'Local translation failed. Check the selected GGUF model and available memory.',
  })
const invalidMetadata = () =>
  new TranslationError({
    code: 'InvalidConfig',
    message: 'The GGUF model metadata does not support the configured prompt format.',
  })

const textContent = (message: Prompt.Message): string =>
  message.role === 'system'
    ? message.content
    : Array.join(
        Array.filterMap(message.content, (part: Prompt.Part) =>
          part.type === 'text' ? Result.succeed(part.text) : Result.failVoid,
        ),
        '',
      )

/** Keep native special-token parsing isolated from untrusted user text. */
const tokenizePrompt = (model: LlamaModel, config: LocalConfig, prompt: Prompt.Prompt) => {
  if (config.model.prompt === 'plamo') {
    const markers = Array.map(['<|plamo:tag|>', '<|plamo:bos|>'], (text) => {
      const tokens = model.tokenize(text, true)
      if (tokens.length !== 1 || !model.isSpecialToken(tokens[0])) throw invalidMetadata()
      return tokens
    })
    const body = new LlamaText(
      ...Array.map(prompt.content, (message) =>
        message.role === 'user' ? textContent(message) : new SpecialTokensText(textContent(message)),
      ),
    )
    const bos = model.tokens.bos
    if (bos === null || model.tokens.bosString !== '<|plamo:bos|>') throw invalidMetadata()
    return { tokens: Array.prepend(body.tokenize(model.tokenizer), bos), stops: markers }
  }
  // Explicit chat mode requires valid metadata instead of a guessed generic wrapper.
  if (typeof model.fileInfo.metadata.tokenizer?.chat_template !== 'string') throw invalidMetadata()
  const wrapper = resolveChatWrapper(model, { fallbackToOtherWrappersOnJinjaError: false, warningLogs: false })
  const history = Array.map(prompt.content, (message): ChatHistoryItem => {
    if (message.role === 'system') return { type: 'system', text: message.content }
    if (message.role === 'user') return { type: 'user', text: textContent(message) }
    if (message.role === 'assistant') return { type: 'model', response: [textContent(message)] }
    throw invalidMetadata()
  })
  const state = wrapper.generateContextState({ chatHistory: Array.append(history, { type: 'model', response: [] }) })
  const stops = Array.map(state.stopGenerationTriggers, (trigger) => trigger.tokenize(model.tokenizer))
  if (Array.some(stops, (stop) => stop.length === 0 || stop.length > 1024)) throw invalidMetadata()
  return { tokens: state.contextText.tokenize(model.tokenizer), stops }
}

/** Pulling the next token is the only way to advance inference: no callback queue can overflow. */
async function* decodeTokens(
  model: LlamaModel,
  iterator: AsyncIterable<Token>,
  stops: ReadonlyArray<ReadonlyArray<Token>>,
  maxTokens: number,
) {
  let pending: Token[] = []
  let unicode: Token[] = []
  let history: Token[] = []
  let count = 0
  const decode = (tokens: ReadonlyArray<Token>) => {
    unicode = Array.appendAll(unicode, tokens)
    const text = model.detokenize(unicode, false, history)
    if (text.endsWith('\uFFFD')) return ''
    history = Array.takeRight(Array.appendAll(history, unicode), 32)
    unicode = []
    return text
  }
  for await (const token of iterator) {
    if (model.isEogToken(token)) {
      const tail = decode(pending)
      if (tail !== '') yield tail
      if (unicode.length > 0) yield model.detokenize(unicode, false, history)
      return
    }
    pending = Array.append(pending, token)
    while (pending.length > 0) {
      if (
        Array.some(
          stops,
          (stop) => stop.length === pending.length && Array.every(pending, (value, index) => stop[index] === value),
        )
      ) {
        if (unicode.length > 0) yield model.detokenize(unicode, false, history)
        return
      }
      if (
        Array.some(
          stops,
          (stop) => pending.length < stop.length && Array.every(pending, (value, index) => stop[index] === value),
        )
      )
        break
      const text = decode(Array.take(pending, 1))
      pending = Array.drop(pending, 1)
      if (text !== '') yield text
    }
    count += 1
    if (count >= maxTokens)
      throw new TranslationError({
        code: 'OutputTooLong',
        message:
          'The translation exceeded the output or context token limit. Translate a smaller section or increase the configured limits.',
      })
  }
  const tail = decode(pending)
  if (tail !== '') yield tail
  if (unicode.length > 0) yield model.detokenize(unicode, false, history)
}

export const generate = (
  model: LlamaModel,
  config: LocalConfig,
  prompt: Prompt.Prompt,
): Stream.Stream<string, TranslationError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* Effect.try({
        try: () => tokenizePrompt(model, config, prompt),
        catch: (error) => (error instanceof TranslationError ? error : invalidMetadata()),
      })
      if (input.tokens.length >= config.contextSize - 1)
        return yield* Effect.fail(
          new TranslationError({
            code: 'ContextTooLong',
            message: 'The source text exceeds the local model context. Translate a smaller section.',
          }),
        )
      // Passing createSignal to 3.22.3 can leak its model disposal guard on aborted allocation.
      const context = yield* scopedNative(
        () => model.createContext({ contextSize: config.contextSize, sequences: 1 }),
        (resource) => resource.dispose(),
        inferenceFailed,
      )
      const sequence = context.getSequence()
      const budget = Math.min(config.maxTokens, config.contextSize - input.tokens.length - 1)
      const iterator = yield* Effect.acquireRelease(
        Effect.sync(() => sequence.evaluate(input.tokens, { temperature: 0, yieldEogToken: true })),
        (resource) => Effect.promise(() => resource.return()).pipe(Effect.ignore),
      )
      return Stream.fromAsyncIterable(decodeTokens(model, iterator, input.stops, budget), (error) =>
        error instanceof TranslationError ? error : inferenceFailed(),
      )
    }),
  )
