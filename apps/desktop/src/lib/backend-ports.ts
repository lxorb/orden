import { providePort } from '@orden/contracts'
import { internalInvoke, webInvoke } from './web-backend/src/api'

providePort('backend.web', { invoke: webInvoke })

providePort('backend.internal', { invoke: internalInvoke })
