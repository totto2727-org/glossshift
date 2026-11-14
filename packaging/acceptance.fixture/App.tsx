import * as fs from 'fs/promises'
import process from 'process'

import { Array } from 'effect'
import { mount, signal, Text } from 'nsh'

import { productionEntry } from '../../batch/entry-acceptance.fixture.ts'
import { check, create } from '../acceptance-support.fixture.ts'
import { launcherAcceptance } from '../launcher-acceptance.fixture.ts'

mount(() => {
  const status = signal('Acceptance running')
  const run = async () => {
    const context = await create()
    try {
      const dataDirectory = process.dataDir
      if (dataDirectory === null) throw new Error('Missing official test data directory')
      const before = await fs.readdir(dataDirectory)
      let rejected = false
      try {
        const unexpected = await create(`${context.root}/missing-acceptance-fixtures`)
        await unexpected.dispose()
      } catch {
        rejected = true
      }
      check(rejected, 'Missing fixture initialization unexpectedly succeeded')
      const after = await fs.readdir(dataDirectory)
      check(
        before.length === after.length && Array.every(before, (path) => Array.contains(after, path)),
        'Partial initialization leaked its private directory',
      )
      await productionEntry(context)
      status.set('Production entry: 7 cases passed')
    } finally {
      await context.dispose()
    }
    const launcher = await create()
    try {
      await launcherAcceptance(launcher)
    } finally {
      await launcher.dispose()
    }
    status.set('Acceptance passed: 7 production entry cases, 13 launcher cases including real PTY')
  }
  void run().catch((error: unknown) => status.set(`Acceptance failed: ${String(error)}`))
  return <Text>{status()}</Text>
})
