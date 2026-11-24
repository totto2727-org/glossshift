import { mount } from 'nsh'

import { Application } from './application.tsx'
import { connectDesktopRuntime } from './desktop-runtime.ts'

mount(() => <Application connect={connectDesktopRuntime} />)
