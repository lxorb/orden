export const LONGEST_PATH = 300

const A_DISK = /^[A-Za-z]:/

export function staysInside(path: string): boolean {
  return (
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !A_DISK.test(path) &&
    !/\p{Cc}/u.test(path) &&
    !path.split('/').includes('..')
  )
}
