globalThis.nibRestore = async function nibRestore(op, argsJson) {
  const args = JSON.parse(argsJson)

  function bytes(text) {
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at++) out[at] = binary.charCodeAt(at)
    return out
  }

  function buffer(text) {
    return bytes(text).buffer
  }

  function number(encoded) {
    if (!Array.isArray(encoded)) return encoded
    return { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }[encoded[1]]
  }

  function algorithmFrom(algorithm) {
    const out = {}
    for (const [key, value] of Object.entries(algorithm)) {
      if (Array.isArray(value)) out[key] = new Uint8Array(value)
      else if (value && typeof value === 'object') out[key] = algorithmFrom(value)
      else out[key] = value
    }
    return out
  }

  async function imported(encoded, into) {
    if (!Array.isArray(encoded)) return
    const [tag] = encoded
    switch (tag) {
      case 'k': {
        const [, format, key, algorithm, usages] = encoded
        const data = format === 'raw' ? bytes(key) : key
        into.set(
          encoded,
          await crypto.subtle.importKey(format, data, algorithmFrom(algorithm), true, usages),
        )
        return
      }
      case 'o':
        for (let at = 1; at < encoded[1].length; at += 2) await imported(encoded[1][at], into)
        return
      case 'A':
        for (let at = 1; at < encoded[2].length; at += 2) await imported(encoded[2][at], into)
        return
      case 'a':
      case 's':
      case 'm':
        for (const one of encoded[1]) await imported(one, into)
        return
      case 'v':
        await imported(encoded[4], into)
        return
      default:
    }
  }

  function decode(root, keys) {
    const made = []

    function reserve() {
      made.push(undefined)
      return made.length - 1
    }

    function own(target, key, value) {
      Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }

    function decoded(encoded) {
      if (!Array.isArray(encoded)) return encoded
      const [tag] = encoded
      switch (tag) {
        case 'u':
          return undefined
        case 'n':
          return number(encoded)
        case 'i':
          return BigInt(encoded[1])
        case '#':
          return made[encoded[1]]
        case 'o': {
          const out = {}
          made.push(out)
          const list = encoded[1]
          for (let at = 0; at < list.length; at += 2) own(out, list[at], decoded(list[at + 1]))
          return out
        }
        case 'a': {
          const out = []
          made.push(out)
          for (const one of encoded[1]) out.push(decoded(one))
          return out
        }
        case 'A': {
          const out = new Array(encoded[1])
          made.push(out)
          const list = encoded[2]
          for (let at = 0; at < list.length; at += 2) own(out, list[at], decoded(list[at + 1]))
          return out
        }
        case 'd': {
          const out = new Date(encoded[1] === null ? NaN : encoded[1])
          made.push(out)
          return out
        }
        case 'r': {
          const out = new RegExp(encoded[1], encoded[2])
          made.push(out)
          return out
        }
        case 'm': {
          const out = new Map()
          made.push(out)
          const list = encoded[1]
          for (let at = 0; at < list.length; at += 2) {
            out.set(decoded(list[at]), decoded(list[at + 1]))
          }
          return out
        }
        case 's': {
          const out = new Set()
          made.push(out)
          for (const one of encoded[1]) out.add(decoded(one))
          return out
        }
        case 'B':
        case 'N':
        case 'S':
        case 'I': {
          const plain = { B: Boolean, N: number, S: String, I: BigInt }[tag](encoded[1])
          const out = Object(plain)
          made.push(out)
          return out
        }
        case 'ab': {
          const out = buffer(encoded[1])
          made.push(out)
          return out
        }
        case 'v': {
          const [, name, offset, length, source] = encoded
          const at = reserve()
          const underneath = decoded(source)
          const View = globalThis[name]
          made[at] = new View(underneath, offset, length)
          return made[at]
        }
        case 'b': {
          const out = new Blob([bytes(encoded[2])], { type: encoded[1] })
          made.push(out)
          return out
        }
        case 'f': {
          const [, name, type, lastModified, data] = encoded
          const out = new File([bytes(data)], name, { type, lastModified })
          made.push(out)
          return out
        }
        case 'e': {
          const [, name, message, stack] = encoded
          const Kind = globalThis[name]
          const out =
            typeof Kind === 'function' && Kind.prototype instanceof Error
              ? new Kind(message)
              : new Error(message)
          if (out.name !== name) own(out, 'name', name)
          Object.defineProperty(out, 'stack', {
            value: stack,
            writable: true,
            enumerable: false,
            configurable: true,
          })
          made.push(out)
          return out
        }
        case 'k': {
          const out = keys.get(encoded)
          made.push(out)
          return out
        }
        case 'img': {
          const [, width, height, colorSpace, data] = encoded
          const out = new ImageData(new Uint8ClampedArray(bytes(data).buffer), width, height, {
            colorSpace,
          })
          made.push(out)
          return out
        }
        default:
          throw new Error(`nothing is encoded as ${String(tag)}`)
      }
    }

    return decoded(root)
  }

  function answered(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('the request failed'))
    })
  }

  function deleted(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      const late = setTimeout(
        () => reject(new Error(`${name} is held open by a page of the site`)),
        5000,
      )
      request.onsuccess = () => {
        clearTimeout(late)
        resolve()
      }
      request.onerror = () => {
        clearTimeout(late)
        reject(request.error)
      }
    })
  }

  async function cleared() {
    localStorage.clear()
    for (const one of await indexedDB.databases()) {
      if (typeof one.name === 'string') await deleted(one.name)
    }
    return {}
  }

  function replaced(storage, items) {
    storage.clear()
    for (const [key, value] of items) storage.setItem(key, value)
    return { items: items.length }
  }

  async function rebuilt(db) {
    const keys = new Map()
    for (const store of db.stores) {
      for (const [key, value] of store.records) {
        await imported(key, keys)
        await imported(value, keys)
      }
    }

    const request = indexedDB.open(db.name, db.version)
    request.onupgradeneeded = () => {
      const opened = request.result
      for (const store of db.stores) {
        const created = opened.createObjectStore(store.name, {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
        })
        for (const index of store.indexes) {
          created.createIndex(index.name, index.keyPath, {
            unique: index.unique,
            multiEntry: index.multiEntry,
          })
        }
      }
    }
    const opened = await answered(request)

    let count = 0
    try {
      if (db.stores.length) {
        const transaction = opened.transaction(
          db.stores.map((store) => store.name),
          'readwrite',
        )
        const done = new Promise((resolve, reject) => {
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error ?? new Error('aborted'))
        })
        for (const store of db.stores) {
          const target = transaction.objectStore(store.name)
          for (const [key, value] of store.records) {
            const decodedValue = decode(value, keys)
            if (store.keyPath === null) target.put(decodedValue, decode(key, keys))
            else target.put(decodedValue)
            count++
          }
        }
        await done
      }
    } finally {
      opened.close()
    }
    return { records: count }
  }

  switch (op) {
    case 'clear':
      return JSON.stringify(await cleared())
    case 'local':
      return JSON.stringify(replaced(localStorage, args))
    case 'session':
      return JSON.stringify(replaced(sessionStorage, args))
    case 'database':
      return JSON.stringify(await rebuilt(args))
    default:
      throw new Error(`there is no restore called ${op}`)
  }
}
