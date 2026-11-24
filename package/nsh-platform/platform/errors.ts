import { PlatformError, Predicate } from 'effect'

const firstArgument = 0
type SystemErrorOptions = Omit<Parameters<typeof PlatformError.systemError>[typeof firstArgument], '_tag'>

export const systemError = (
  tag: PlatformError.SystemErrorTag,
  options: SystemErrorOptions,
): PlatformError.PlatformError =>
  // oxlint-disable-next-line rules/require-tagged-data -- Effect PlatformError.systemError requires the native reason tag in its options.
  PlatformError.systemError({ _tag: tag, ...options })

export const unsupported = (module: string, method: string): PlatformError.PlatformError =>
  systemError('BadResource', {
    description: `Unsupported by the official NSH 0.5 host: ${method}`,
    method,
    module,
  })

const reasons = new Map<string, PlatformError.SystemErrorTag>([
  ['EACCES', 'PermissionDenied'],
  ['EEXIST', 'AlreadyExists'],
  ['ENOENT', 'NotFound'],
  ['ERR_ACCESS_DENIED', 'PermissionDenied'],
])

type ErrorDetails = Readonly<{ method: string; path: string; cause: unknown; module: string }>

export const platformFailure = ({ method, path, cause, module }: ErrorDetails): PlatformError.PlatformError => {
  const code = Predicate.isObject(cause) && !Predicate.isFunction(cause) && 'code' in cause ? cause['code'] : undefined
  const reason = Predicate.isString(code) ? reasons.get(code) : undefined
  return systemError(reason ?? 'Unknown', {
    cause,
    method,
    module,
    pathOrDescriptor: path,
  })
}

export const failure = (method: string, path: string, cause: unknown): PlatformError.PlatformError =>
  platformFailure({ cause, method, module: 'FileSystem', path })
