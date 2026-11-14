import { Bridge } from 'glossshift/native'
import { mount } from 'nsh'

import { Application } from './application'
import { connectNative } from './native-adapter'

mount(() => <Application connect={connectNative(Bridge)} />)
