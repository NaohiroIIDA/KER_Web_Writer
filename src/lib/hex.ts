export type HexRecord = {
  byteCount: number
  address: number
  type: number
  data: Uint8Array
  checksum: number
}

export type ParsedHex = {
  records: HexRecord[]
  dataBytes: number
  minAddress: number | null
  maxAddress: number | null
  binary: Uint8Array
}

function parseHexByte(value: string, lineNumber: number): number {
  if (!/^[0-9a-fA-F]{2}$/.test(value)) {
    throw new Error(`line ${lineNumber}: invalid hex byte '${value}'`)
  }
  return Number.parseInt(value, 16)
}

function computeChecksum(bytes: number[]): number {
  const sum = bytes.reduce((acc, current) => acc + current, 0)
  return ((~sum + 1) & 0xff) >>> 0
}

export function parseIntelHex(source: string): ParsedHex {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new Error('HEX file is empty')
  }

  const records: HexRecord[] = []
  const bytesByAddress = new Map<number, number>()
  let extendedLinearAddress = 0

  lines.forEach((line, index) => {
    const lineNumber = index + 1

    if (!line.startsWith(':')) {
      throw new Error(`line ${lineNumber}: missing ':' prefix`)
    }

    const payload = line.slice(1)
    if (payload.length < 10 || payload.length % 2 !== 0) {
      throw new Error(`line ${lineNumber}: malformed payload length`)
    }

    const raw: number[] = []
    for (let i = 0; i < payload.length; i += 2) {
      raw.push(parseHexByte(payload.slice(i, i + 2), lineNumber))
    }

    const byteCount = raw[0]
    const address = (raw[1] << 8) | raw[2]
    const type = raw[3]

    if (raw.length !== byteCount + 5) {
      throw new Error(`line ${lineNumber}: byte count mismatch`)
    }

    const checksum = raw[raw.length - 1]
    const computed = computeChecksum(raw.slice(0, -1))
    if (checksum !== computed) {
      throw new Error(
        `line ${lineNumber}: checksum mismatch expected 0x${computed
          .toString(16)
          .padStart(2, '0')} got 0x${checksum.toString(16).padStart(2, '0')}`,
      )
    }

    const data = new Uint8Array(raw.slice(4, 4 + byteCount))
    records.push({ byteCount, address, type, data, checksum })

    if (type === 0x00) {
      const absoluteBase = (extendedLinearAddress << 16) | address
      data.forEach((byte, offset) => {
        bytesByAddress.set(absoluteBase + offset, byte)
      })
    }

    if (type === 0x04) {
      if (byteCount !== 2) {
        throw new Error(`line ${lineNumber}: invalid extended linear address`) 
      }
      extendedLinearAddress = (data[0] << 8) | data[1]
    }
  })

  const usedAddresses = [...bytesByAddress.keys()].sort((a, b) => a - b)
  if (usedAddresses.length === 0) {
    throw new Error('HEX file has no data records')
  }

  const minAddress = usedAddresses[0]
  const maxAddress = usedAddresses[usedAddresses.length - 1]
  const binary = new Uint8Array(maxAddress - minAddress + 1)
  binary.fill(0xff)

  for (const address of usedAddresses) {
    const byte = bytesByAddress.get(address)
    if (byte !== undefined) {
      binary[address - minAddress] = byte
    }
  }

  return {
    records,
    dataBytes: usedAddresses.length,
    minAddress,
    maxAddress,
    binary,
  }
}
