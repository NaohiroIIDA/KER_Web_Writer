export type Tiny1616FuseName = 'fuse0' | 'fuse1' | 'fuse2' | 'fuse5' | 'fuse6' | 'fuse7' | 'fuse8'

export const TINY1616_FUSE_MAP: Record<Tiny1616FuseName, number> = {
  fuse0: 0x00,
  fuse1: 0x00,
  fuse2: 0x02,
  fuse5: 0xc5,
  fuse6: 0x04,
  fuse7: 0x00,
  fuse8: 0x00,
}

export const TINY1616_FUSE_ORDER: Tiny1616FuseName[] = [
  'fuse0',
  'fuse1',
  'fuse2',
  'fuse5',
  'fuse6',
  'fuse7',
  'fuse8',
]

export function formatFuseValue(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`
}

export function validateFuseValues(input: Partial<Record<Tiny1616FuseName, number>>): {
  ok: boolean
  errors: string[]
} {
  const errors: string[] = []

  for (const fuseName of TINY1616_FUSE_ORDER) {
    const expected = TINY1616_FUSE_MAP[fuseName]
    const received = input[fuseName]
    if (received === undefined) {
      errors.push(`${fuseName} is missing`)
      continue
    }
    if (received !== expected) {
      errors.push(
        `${fuseName} expected ${formatFuseValue(expected)} but got ${formatFuseValue(received)}`,
      )
    }
  }

  const fuse5 = input.fuse5
  if (fuse5 !== undefined) {
    const crcSrc = (fuse5 >> 6) & 0b11
    if (crcSrc !== 0b11) {
      errors.push('fuse5 CRCSRC bits must stay 0b11 to avoid brick risk')
    }
  }

  return { ok: errors.length === 0, errors }
}
