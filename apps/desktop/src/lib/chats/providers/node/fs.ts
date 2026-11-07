function absent(): never {
  throw new Error('there are no files to reach here')
}

export const createReadStream = absent
export const createWriteStream = absent
export const readFile = absent
export const writeFile = absent
export const unlink = absent
export const stat = absent
export const mkdir = absent
export const WriteStream = absent

export const promises = { readFile, writeFile, unlink, stat, mkdir }

export default { createReadStream, createWriteStream, promises, WriteStream }
