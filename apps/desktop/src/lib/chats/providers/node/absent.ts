function absent(): never {
  throw new Error('not available here')
}

export const exec = absent
export const request = absent
export const get = absent
export const createInterface = absent

export default {}
