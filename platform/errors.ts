import { PlatformError } from 'effect'

export const unsupported = (module: string, method: string) =>
  PlatformError.systemError({
    _tag: 'BadResource',
    module,
    method,
    description: `Unsupported by the official NSH 0.5 host: ${method}`,
  })

export const failure = (method: string, path: string, cause: unknown, module = 'FileSystem') => {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
  return PlatformError.systemError({
    _tag:
      code === 'ENOENT'
        ? 'NotFound'
        : code === 'EEXIST'
          ? 'AlreadyExists'
          : code === 'EACCES' || code === 'ERR_ACCESS_DENIED'
            ? 'PermissionDenied'
            : 'Unknown',
    module,
    method,
    pathOrDescriptor: path,
    cause,
  })
}
