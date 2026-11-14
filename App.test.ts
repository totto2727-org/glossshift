import './src/domain.test'
import './src/controller.test'
import './src/ui.test'
import './src/native-adapter.test'
import './src/terminal.test'
import './src/native-session.test'
import './src/desktop-controls.test'
import './src/desktop-shortcuts.test'
import './src/desktop-window.test'
import './src/selection-client.test'
import { registerProcessPipeTest } from './src/local-client.test'

registerProcessPipeTest('./src/local-process.fixture/App.tsx')
