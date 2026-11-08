import type * as Real from './faces'

export type Faces = Real.Faces

export const NO_FACES: typeof Real.NO_FACES = new Map()

export const faceOf: typeof Real.faceOf = () => ''

export const pdfFaces: typeof Real.pdfFaces = () => Promise.resolve(NO_FACES)
