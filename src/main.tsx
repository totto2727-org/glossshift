import { Bridge } from 'glossshift/native'
import { mount, platform } from 'nsh'

import { Application } from './application'
import { connectNative } from './native-adapter'
import { TerminalApplication } from './terminal'

mount(() =>
  platform.idiom === 'terminal' ? (
    <TerminalApplication connect={connectNative(Bridge, 'terminal')} />
  ) : (
    <Application connect={connectNative(Bridge)} />
  ),
)
