globalThis.ordenDump = async function ordenDump(op, argsJson) {
  const args = JSON.parse(argsJson)

  class Unmovable extends Error {}

  const VIEWS = [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float16Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
  ].filter((name) => typeof globalThis[name] === 'function')

  function base64(bytes) {
    let text = ''
    for (let at = 0; at < bytes.length; at += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000))
    }
    return btoa(text)
  }

  function kind(value) {
    return Object.prototype.toString.call(value).slice(8, -1)
  }

  function algorithmOf(algorithm) {
    const out = {}
    for (const [key, value] of Object.entries(algorithm)) {
      if (value instanceof Uint8Array) out[key] = [...value]
      else if (value && typeof value === 'object') out[key] = algorithmOf(value)
      else out[key] = value
    }
    return out
  }

  function encoder() {
    const seen = new Map()
    const later = []
    const counted = { size: 0 }

    function number(value) {
      if (Object.is(value, -0)) return ['n', '-0']
      if (Number.isNaN(value)) return ['n', 'NaN']
      if (value === Infinity) return ['n', 'Infinity']
      if (value === -Infinity) return ['n', '-Infinity']
      counted.size += 8
      return value
    }

    function pairs(entries) {
      const out = []
      for (const [key, value] of entries) out.push(encode(key), encode(value))
      return out
    }

    function bytesOf(buffer, offset, length) {
      counted.size += Math.ceil((length * 4) / 3)
      return base64(new Uint8Array(buffer, offset, length))
    }

    function later64(node, read) {
      later.push(async () => {
        node[node.length - 1] = base64(new Uint8Array(await read()))
      })
      return node
    }

    function encode(value) {
      switch (typeof value) {
        case 'string':
          counted.size += value.length + 2
          return value
        case 'number':
          return number(value)
        case 'boolean':
          counted.size += 5
          return value
        case 'undefined':
          return ['u']
        case 'bigint':
          return ['i', value.toString()]
        case 'object':
          break
        default:
          throw new Unmovable(`a ${typeof value} cannot be stored`)
      }
      if (value === null) return null

      const known = seen.get(value)
      if (known !== undefined) return ['#', known]
      seen.set(value, seen.size)
      counted.size += 4

      const tag = kind(value)
      switch (tag) {
        case 'Object':
          return ['o', Object.keys(value).flatMap((key) => [key, encode(value[key])])]
        case 'Array': {
          const keys = Object.keys(value)
          const dense = keys.length === value.length && keys.every((key, at) => key === String(at))
          if (dense) return ['a', value.map(encode)]
          return ['A', value.length, keys.flatMap((key) => [key, encode(value[key])])]
        }
        case 'Date': {
          const time = value.getTime()
          return ['d', Number.isNaN(time) ? null : time]
        }
        case 'RegExp':
          return ['r', value.source, value.flags]
        case 'Map':
          return ['m', pairs(value)]
        case 'Set':
          return ['s', [...value].map(encode)]
        case 'Boolean':
          return ['B', value.valueOf()]
        case 'Number':
          return ['N', number(value.valueOf())]
        case 'String':
          return ['S', value.valueOf()]
        case 'BigInt':
          return ['I', value.valueOf().toString()]
        case 'ArrayBuffer':
          return ['ab', bytesOf(value, 0, value.byteLength)]
        case 'DataView':
          return ['v', 'DataView', value.byteOffset, value.byteLength, encode(value.buffer)]
        case 'Blob':
          counted.size += Math.ceil((value.size * 4) / 3)
          return later64(['b', value.type, ''], () => value.arrayBuffer())
        case 'File':
          counted.size += Math.ceil((value.size * 4) / 3)
          return later64(['f', value.name, value.type, value.lastModified, ''], () =>
            value.arrayBuffer(),
          )
        case 'Error':
          return ['e', String(value.name), String(value.message), String(value.stack ?? '')]
        case 'CryptoKey': {
          if (!value.extractable) throw new Unmovable('a key that may not be exported')
          const format = value.type === 'secret' ? 'raw' : 'jwk'
          const node = ['k', format, null, algorithmOf(value.algorithm), [...value.usages]]
          later.push(async () => {
            const exported = await crypto.subtle.exportKey(format, value)
            node[2] = format === 'raw' ? base64(new Uint8Array(exported)) : exported
          })
          return node
        }
        case 'ImageData':
          return [
            'img',
            value.width,
            value.height,
            value.colorSpace ?? 'srgb',
            bytesOf(value.data.buffer, value.data.byteOffset, value.data.byteLength),
          ]
        default:
          if (VIEWS.includes(tag)) {
            return ['v', tag, value.byteOffset, value.length, encode(value.buffer)]
          }
          throw new Unmovable(`a ${tag} cannot be carried`)
      }
    }

    return {
      root(value) {
        seen.clear()
        return encode(value)
      },
      counted,
      async settle() {
        for (const one of later) await one()
      },
    }
  }

  function stored(storage) {
    try {
      const out = []
      for (let at = 0; at < storage.length; at++) {
        const key = storage.key(at)
        if (key !== null) out.push([key, storage.getItem(key) ?? ''])
      }
      return out
    } catch {
      return null
    }
  }

  async function listed(asked) {
    let databases = []
    try {
      databases = (await indexedDB.databases())
        .filter((one) => typeof one.name === 'string')
        .map((one) => ({ name: one.name, version: one.version }))
    } catch {
      // An engine without `databases()`, or storage refused: nothing to carry.
    }
    return {
      origin: location.origin,
      local: stored(localStorage),
      session: asked.session ? stored(sessionStorage) : null,
      databases,
    }
  }

  function opened(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name)
      let fresh = false
      request.onupgradeneeded = () => {
        fresh = true
        request.transaction.abort()
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => (fresh ? resolve(null) : reject(request.error))
      request.onblocked = () => reject(new Error(`${name} is held open elsewhere`))
    })
  }

  function walked(store, each) {
    return new Promise((resolve, reject) => {
      const request = store.openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        try {
          each(cursor.primaryKey, cursor.value)
        } catch (error) {
          reject(error)
          return
        }
        cursor.continue()
      }
    })
  }

  async function dumped(name, most) {
    const db = await opened(name)
    if (!db) return { skip: 'gone', size: 0 }

    const kept = encoder()
    const names = [...db.objectStoreNames]
    const stores = []
    let skip = null
    let size = 0

    function each(records, key, value) {
      if (skip === 'unmovable') return
      try {
        if (skip === 'large') {
          const probe = encoder()
          probe.root(key)
          probe.root(value)
          size += probe.counted.size
          return
        }
        const record = [kept.root(key), kept.root(value)]
        size = kept.counted.size
        if (size > most) {
          skip = 'large'
          stores.length = 0
        } else records.push(record)
      } catch (error) {
        if (!(error instanceof Unmovable)) throw error
        skip = 'unmovable'
      }
    }

    try {
      const transaction = names.length ? db.transaction(names, 'readonly') : null
      await Promise.all(
        names.map((storeName) => {
          const store = transaction.objectStore(storeName)
          const records = []
          stores.push({
            name: storeName,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: [...store.indexNames].map((indexName) => {
              const index = store.index(indexName)
              return {
                name: index.name,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry,
              }
            }),
            records,
          })
          return walked(store, (key, value) => each(records, key, value))
        }),
      )
      if (!skip) await kept.settle()
    } finally {
      db.close()
    }

    if (skip) return { skip, size }
    return { size, db: { name, version: db.version, stores } }
  }

  if (op === 'list') return JSON.stringify(await listed(args))
  if (op === 'database') return JSON.stringify(await dumped(args.name, args.most ?? Infinity))
  throw new Error(`there is no dump called ${op}`)
}
