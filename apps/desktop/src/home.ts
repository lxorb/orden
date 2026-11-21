import '@orden/themes/tokens.css'
import '@orden/themes/base.css'
import '@fontsource-variable/geist'
import './lib/showcase/src/home.css'
import { homePage } from './lib/showcase/src/api'

void homePage().then(({ showHome }) => showHome(window))
