import { mount } from 'nsh'

import { TerminalApplication } from './terminal'
import { connectTerminalRuntime } from './terminal-adapter'

mount(() => <TerminalApplication connect={connectTerminalRuntime} />)
