import { type Cost, scrypt } from './scrypt'

interface Asked {
  id: number
  password: Uint8Array<ArrayBuffer>
  salt: Uint8Array<ArrayBuffer>
  cost: Cost
  length: number
}

self.onmessage = (event: MessageEvent<Asked>) => {
  const { id, password, salt, cost, length } = event.data
  scrypt(password, salt, cost, length).then(
    (key) => self.postMessage({ id, key }),
    (error: unknown) => self.postMessage({ id, error: String(error) }),
  )
}
