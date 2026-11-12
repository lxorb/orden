const BUMP = 'update pass_seq set seq = seq + 1 where id = 1'

export const SEQ = '(select seq from pass_seq where id = 1)'

export function bump(db: D1Database): D1PreparedStatement {
  return db.prepare(BUMP)
}

export async function seqNow(db: D1Database): Promise<number> {
  const row = await db.prepare(`select ${SEQ} as seq`).first<{ seq: number }>()
  return row?.seq ?? 0
}
