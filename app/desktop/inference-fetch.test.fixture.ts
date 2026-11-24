import { Array, Data, Option, Predicate, Schema } from 'effect'

import { runTestEffect } from './inference.test.fixture.ts'

export const server = { key: 'synthetic', origin: 'http://127.0.0.1:1' }
export const TokenRequest = Schema.Struct({
  add_special: Schema.Boolean,
  content: Schema.String,
  parse_special: Schema.Boolean,
})

const TemplateRequest = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.String, role: Schema.String })),
})
const CompletionRequest = Schema.Struct({ n_predict: Schema.Int, prompt: Schema.Unknown })
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The native fetch fixture receives unvalidated JSON request bodies.
const decodeTokenRequest = Schema.decodeUnknownEffect(TokenRequest)
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The native fetch fixture receives unvalidated JSON request bodies.
const decodeTemplateRequest = Schema.decodeUnknownEffect(TemplateRequest)
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The native fetch fixture receives unvalidated JSON request bodies.
export const decodeCompletionRequest = Schema.decodeUnknownEffect(CompletionRequest)

class UnexpectedFixtureRequest extends Data.TaggedError('UnexpectedFixtureRequest')<{ message: string }> {}

type FixtureRoute = (init?: RequestInit) => Response | Promise<Response>

export const fixtureFetch =
  (routes: Readonly<Record<string, FixtureRoute>>): typeof fetch =>
  async (request, init) => {
    const { pathname } = new URL(String(request))
    const route = routes[pathname]
    if (Predicate.isNullish(route)) {
      throw new UnexpectedFixtureRequest({ message: `Unexpected fixture route: ${pathname}` })
    }
    return route(init)
  }

export const withFixtureFetch = async (mock: typeof fetch, run: () => Promise<void>): Promise<void> => {
  const { fetch: original } = globalThis
  globalThis.fetch = mock
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

export const fixtureBody = (init?: RequestInit): unknown =>
  Predicate.isString(init?.body) ? JSON.parse(init.body) : undefined

const chatBosId = 1
const chatOtherId = 4
const chatSourceId = 7

const chatFixtureTokens = (request: typeof TokenRequest.Type, source: string): Readonly<number[]> => {
  if (request.content === '<bos>' || request.add_special) {
    return [chatBosId]
  }
  if (request.content === source) {
    return [chatSourceId]
  }
  return request.content.startsWith('<bos>') ? [chatBosId, chatOtherId] : [chatOtherId]
}

const plamoBos = '<|plamo:bos|>'
const plamoTag = '<|plamo:tag|>'
const plamoBosId = 1
const plamoTagId = 2
const plamoSourceId = 3

export const plamoFixtureTokens = (content: string, sourceCount = 1): Readonly<number[]> => {
  if (content === plamoBos) {
    return [plamoBosId]
  }
  if (content === plamoTag) {
    return [plamoTagId]
  }
  return Array.makeBy(sourceCount, () => plamoSourceId)
}

export const readTokenRequest = (init?: RequestInit): Promise<typeof TokenRequest.Type> =>
  runTestEffect(decodeTokenRequest(fixtureBody(init)))

export const plamoTokenResponse = async (init?: RequestInit): Promise<Response> => {
  const request = await readTokenRequest(init)
  return Response.json({ tokens: plamoFixtureTokens(request.content) })
}

export interface ChatFixture {
  explicitBos: boolean
  requests: (typeof TokenRequest.Type)[]
  markers: string[]
}

const templateMarker = (request: typeof TemplateRequest.Type): string => {
  const user = Array.findFirst(request.messages, (message) => message.role === 'user')
  return Option.getOrThrowWith(
    Option.map(user, (message) => message.content),
    () => new UnexpectedFixtureRequest({ message: 'Missing inert user marker' }),
  )
}

export const chatFixtureFetch = (source: string, fixture: ChatFixture): typeof fetch =>
  fixtureFetch({
    '/apply-template': async (init) => {
      const request = await runTestEffect(decodeTemplateRequest(fixtureBody(init)))
      const marker = templateMarker(request)
      fixture.markers.push(marker)
      const prefix = fixture.explicitBos ? '<bos>' : ''
      return Response.json({ prompt: `${prefix}HEAD${marker}TAIL` })
    },
    '/props': () => Response.json({ bos_token: '<bos>' }),
    '/tokenize': async (init) => {
      const request = await readTokenRequest(init)
      fixture.requests.push(request)
      return Response.json({ tokens: chatFixtureTokens(request, source) })
    },
  })
