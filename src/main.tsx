import { mount } from 'nsh'

import { Application } from './application'
import { connectDesktopRuntime } from './native-adapter'

mount(() => <Application connect={connectDesktopRuntime} />)
