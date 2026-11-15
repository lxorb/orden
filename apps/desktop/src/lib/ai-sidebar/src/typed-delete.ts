export function deletesTyped(field: {
  value: string
  selectionStart: number | null
  selectionEnd: number | null
}): boolean {
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  return start !== end || start < field.value.length
}
