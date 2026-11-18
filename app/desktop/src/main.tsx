import { mount } from 'nsh'

import { Application } from './application'
import { connectDesktopRuntime } from './nativeAdapter'

mount(() => <Application connect={connectDesktopRuntime} />)
