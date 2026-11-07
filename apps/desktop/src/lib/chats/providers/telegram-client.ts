import { MemoryStorage, TelegramClient, type tl } from '@mtcute/web'
import { signedOut, type Client, type ClientState, type Setup } from '@orden/chats/telegram'

export async function dial(setup: Setup): Promise<Client> {
  const client = new TelegramClient({
    apiId: setup.apiId,
    apiHash: setup.apiHash,
    storage: new MemoryStorage(),
    logLevel: 1,
    initConnectionOptions: { deviceModel: 'Orden', appVersion: '1.0' },
  })
  if (setup.session) await client.importSession(setup.session, true)
  await client.connect()
  let started = false
  const loggedIn = (user: { raw: tl.RawUser }) => {
    started = true
    return user.raw
  }
  return {
    call: (request) => client.call(request),
    listen(update, state) {
      const raw = (info: {
        update: tl.TypeUpdate
        peers: { users: Map<number, tl.TypeUser>; chats: Map<number, tl.TypeChat> }
      }) =>
        update(info.update, {
          users: [...info.peers.users.values()],
          chats: [...info.peers.chats.values()],
        })
      const changed = (now: string) => {
        const mapped: ClientState =
          now === 'connected' ? 'online' : now === 'offline' ? 'offline' : 'connecting'
        state(mapped)
      }
      const failed = (error: Error) => {
        if (signedOut(error)) state('signed-out')
      }
      client.onRawUpdate.add(raw)
      client.onConnectionState.add(changed)
      client.onError.add(failed)
      return () => {
        client.onRawUpdate.remove(raw)
        client.onConnectionState.remove(changed)
        client.onError.remove(failed)
      }
    },
    async sendCode(phone) {
      const sent = await client.sendCode({ phone })
      if (!('phoneCodeHash' in sent)) return loggedIn(sent)
      const via =
        sent.type === 'app' || sent.type === 'sms' || sent.type === 'call' ? sent.type : 'other'
      return { hash: sent.phoneCodeHash, via }
    },
    signIn: async (phone, hash, code) =>
      loggedIn(await client.signIn({ phone, phoneCodeHash: hash, phoneCode: code })),
    checkPassword: async (password) => loggedIn(await client.checkPassword(password)),
    hint: () => client.getPasswordHint(),
    signInQr: async (show, password, wrong) =>
      loggedIn(
        await client.signInQr({
          onUrlUpdated: (url, expires) => show(url, expires.getTime()),
          password,
          invalidPasswordCallback: wrong,
        }),
      ),
    async ready(me) {
      if (started) return
      started = true
      await client.notifyLoggedIn(me)
    },
    session: () => client.exportSession(),
    download: (location, dc, size) =>
      client.downloadAsBuffer(location, { dcId: dc, ...(size ? { fileSize: size } : {}) }),
    upload: async (bytes, name, type) =>
      (
        await client.uploadFile({
          file: bytes,
          fileName: name,
          fileMime: type,
          fileSize: bytes.length,
        })
      ).inputFile,
    async logOut() {
      await client.logOut()
    },
    close: () => client.destroy(),
  }
}
