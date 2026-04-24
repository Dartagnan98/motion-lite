/**
 * Minimal QR-code SVG generator — ISO/IEC 18004 byte mode, error-correction
 * level M, versions 1..10. Good for URLs up to ~213 bytes, which easily
 * covers any `origin + /l/<slug>` short link.
 *
 * No npm dependency. Pure TS. Returns an SVG string.
 */

export interface QrOptions {
  /** Size in CSS pixels of the viewBox (rendered svg width). Default 320. */
  size?: number
  /** Quiet-zone modules. Default 4 (per ISO spec). */
  margin?: number
  /** Foreground color for dark modules. Default #000. */
  fg?: string
  /** Background color for light modules. Default #fff. */
  bg?: string
}

const EC_LEVEL_M = 0

// Number of data codewords per (version, EC-level M) — ISO/IEC 18004 Table 7.
// index = version - 1
const DATA_CODEWORDS_M: number[] = [
  16, 28, 44, 64, 86, 108, 124, 154, 182, 216,
]

// EC codewords per block for level M — Table 9.
const EC_CODEWORDS_M: number[] = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26,
]

// Number of error-correction blocks for level M — Table 9.
// Each entry: [group1Count, group1DataCodewords, group2Count, group2DataCodewords]
const BLOCKS_M: Array<[number, number, number, number]> = [
  [1, 16, 0, 0],     // v1
  [1, 28, 0, 0],     // v2
  [1, 44, 0, 0],     // v3
  [2, 32, 0, 0],     // v4
  [2, 43, 0, 0],     // v5
  [4, 27, 0, 0],     // v6
  [4, 31, 0, 0],     // v7
  [2, 38, 2, 39],    // v8
  [3, 36, 2, 37],    // v9
  [4, 43, 1, 44],    // v10
]

// Alignment pattern centers per version (v1 has none).
const ALIGNMENT_CENTERS: number[][] = [
  [],                         // v1
  [6, 18],                    // v2
  [6, 22],                    // v3
  [6, 26],                    // v4
  [6, 30],                    // v5
  [6, 34],                    // v6
  [6, 22, 38],                // v7
  [6, 24, 42],                // v8
  [6, 26, 46],                // v9
  [6, 28, 50],                // v10
]

// Galois field (GF(256)) tables
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const generator = rsGeneratorPoly(ecCount)
  const result = new Uint8Array(ecCount)
  const buffer = new Uint8Array(data.length + ecCount)
  buffer.set(data, 0)
  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i]
    if (factor === 0) continue
    for (let j = 0; j < generator.length; j += 1) {
      buffer[i + j] ^= gfMul(generator[j], factor)
    }
  }
  result.set(buffer.subarray(data.length))
  return result
}

function pickVersion(byteLength: number): number {
  // byte-mode data length needs: 4 (mode indicator) + 8 or 16 (char count) + 8*N bits,
  // then padded into codewords. Char count is 8 bits for v1-9, 16 bits for v10+.
  for (let version = 1; version <= 10; version += 1) {
    const capacityBits = DATA_CODEWORDS_M[version - 1] * 8
    const ccBits = version <= 9 ? 8 : 16
    const needed = 4 + ccBits + byteLength * 8
    if (needed <= capacityBits) return version
  }
  throw new Error('QR payload too long (max ~213 bytes)')
}

/** Bit-stream builder. */
class BitBuf {
  data: number[] = []
  push(value: number, bits: number) {
    for (let i = bits - 1; i >= 0; i -= 1) {
      this.data.push((value >>> i) & 1)
    }
  }
  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.data.length / 8))
    for (let i = 0; i < this.data.length; i += 1) {
      if (this.data[i]) bytes[i >>> 3] |= 1 << (7 - (i & 7))
    }
    return bytes
  }
  get length(): number { return this.data.length }
}

function buildDataCodewords(input: string, version: number): Uint8Array {
  // UTF-8 encode.
  const encoder = typeof TextEncoder !== 'undefined'
    ? new TextEncoder()
    : { encode: (s: string) => Uint8Array.from(Buffer.from(s, 'utf-8')) }
  const bytes = encoder.encode(input)
  const ccBits = version <= 9 ? 8 : 16
  const totalDataCodewords = DATA_CODEWORDS_M[version - 1]
  const totalDataBits = totalDataCodewords * 8

  const buf = new BitBuf()
  buf.push(0b0100, 4)           // mode indicator: byte
  buf.push(bytes.length, ccBits) // char count
  for (const b of bytes) buf.push(b, 8)

  // Terminator (up to 4 zero bits)
  const remaining = totalDataBits - buf.length
  buf.push(0, Math.min(4, remaining))

  // Pad to byte boundary
  while (buf.length % 8) buf.push(0, 1)

  // Fill with pad bytes 0xEC, 0x11 alternating
  const padBytes = [0xec, 0x11]
  let padIndex = 0
  while (buf.length < totalDataBits) {
    buf.push(padBytes[padIndex], 8)
    padIndex ^= 1
  }

  return buf.toBytes()
}

function interleaveCodewords(data: Uint8Array, version: number): Uint8Array {
  const [g1Count, g1Size, g2Count, g2Size] = BLOCKS_M[version - 1]
  const blocks: Uint8Array[] = []
  let offset = 0
  for (let i = 0; i < g1Count; i += 1) { blocks.push(data.subarray(offset, offset + g1Size)); offset += g1Size }
  for (let i = 0; i < g2Count; i += 1) { blocks.push(data.subarray(offset, offset + g2Size)); offset += g2Size }

  const ecLen = EC_CODEWORDS_M[version - 1]
  const ecBlocks: Uint8Array[] = blocks.map((b) => rsEncode(b, ecLen))

  const maxDataLen = Math.max(g1Size, g2Size || 0)
  const out: number[] = []
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const b of blocks) if (i < b.length) out.push(b[i])
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const eb of ecBlocks) out.push(eb[i])
  }
  return Uint8Array.from(out)
}

/** Returns size in modules for a given version. */
function sizeForVersion(version: number): number { return 17 + 4 * version }

/** Matrix helpers — true = dark, false = light, null = unset. */
type Matrix = Array<Array<boolean | null>>

function newMatrix(size: number): Matrix {
  const m: Matrix = []
  for (let i = 0; i < size; i += 1) { m.push(new Array(size).fill(null) as (boolean | null)[]) }
  return m
}

function placeFinder(m: Matrix, row: number, col: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r
      const cc = col + c
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue
      const inRing = (r === 0 || r === 6 || c === 0 || c === 6) && r >= 0 && r <= 6 && c >= 0 && c <= 6
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
      const onSeparator = r === -1 || r === 7 || c === -1 || c === 7
      if (onSeparator) { m[rr][cc] = false }
      else if (inRing || inCore) { m[rr][cc] = true }
      else { m[rr][cc] = false }
    }
  }
}

function placeAlignment(m: Matrix, row: number, col: number) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1
      m[row + r][col + c] = dark
    }
  }
}

function isFunctionModule(m: Matrix, row: number, col: number): boolean {
  return m[row][col] !== null
}

function placeTiming(m: Matrix) {
  const size = m.length
  for (let i = 8; i < size - 8; i += 1) {
    if (m[6][i] === null) m[6][i] = i % 2 === 0
    if (m[i][6] === null) m[i][6] = i % 2 === 0
  }
}

function placeFormatInfoReserved(m: Matrix) {
  const size = m.length
  // Reserve the 15-bit format strips around each finder + dark module.
  for (let i = 0; i <= 8; i += 1) {
    if (m[8][i] === null) m[8][i] = false
    if (m[i][8] === null) m[i][8] = false
  }
  for (let i = 0; i < 8; i += 1) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false
  }
  // Dark module (ISO §8.9)
  m[size - 8][8] = true
}

function placeDataBits(m: Matrix, bits: Uint8Array) {
  const size = m.length
  let bitIndex = 0
  let direction = -1 // up
  let col = size - 1
  while (col > 0) {
    if (col === 6) col -= 1 // skip vertical timing column
    let row = direction === -1 ? size - 1 : 0
    for (let i = 0; i < size; i += 1) {
      for (let c = 0; c < 2; c += 1) {
        const cc = col - c
        if (!isFunctionModule(m, row, cc)) {
          const byteIdx = bitIndex >>> 3
          const bitOffset = 7 - (bitIndex & 7)
          const bit = byteIdx < bits.length ? ((bits[byteIdx] >>> bitOffset) & 1) === 1 : false
          m[row][cc] = bit
          bitIndex += 1
        }
      }
      row += direction
    }
    direction = -direction
    col -= 2
  }
}

function maskFn(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0
    case 1: return row % 2 === 0
    case 2: return col % 3 === 0
    case 3: return (row + col) % 3 === 0
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
    default: return false
  }
}

function applyMask(m: Matrix, dataMask: boolean[][], mask: number) {
  const size = m.length
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (dataMask[r][c] && maskFn(mask, r, c)) m[r][c] = !m[r][c]
    }
  }
}

function placeFormatInfo(m: Matrix, mask: number) {
  const size = m.length
  // Format = (EC_M << 3) | mask_pattern ; EC_M bits = 00
  const formatData = (EC_LEVEL_M << 3) | mask
  // BCH(15,5) encode
  let remainder = formatData << 10
  const generator = 0b10100110111
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= generator << (i - 10)
  }
  let format = ((formatData << 10) | (remainder & 0x3ff)) ^ 0b101010000010010

  const bits: number[] = []
  for (let i = 14; i >= 0; i -= 1) bits.push((format >>> i) & 1)
  // Place around top-left finder
  for (let i = 0; i <= 5; i += 1) m[8][i] = bits[i] === 1
  m[8][7] = bits[6] === 1
  m[8][8] = bits[7] === 1
  m[7][8] = bits[8] === 1
  for (let i = 9; i <= 14; i += 1) m[14 - i][8] = bits[i] === 1
  // Around bottom-left + top-right
  for (let i = 0; i <= 7; i += 1) m[size - 1 - i][8] = bits[i] === 1
  for (let i = 8; i <= 14; i += 1) m[8][size - 15 + i] = bits[i] === 1
}

function cloneMatrix(m: Matrix): Matrix { return m.map((row) => row.slice()) }

function maskPenalty(m: Matrix): number {
  const size = m.length
  let penalty = 0
  // Rule 1: runs of 5+ same-color in row/col
  for (let r = 0; r < size; r += 1) {
    let runColor: boolean | null = null
    let run = 0
    for (let c = 0; c < size; c += 1) {
      if (m[r][c] === runColor) run += 1
      else { if (run >= 5) penalty += 3 + (run - 5); runColor = m[r][c]; run = 1 }
    }
    if (run >= 5) penalty += 3 + (run - 5)
  }
  for (let c = 0; c < size; c += 1) {
    let runColor: boolean | null = null
    let run = 0
    for (let r = 0; r < size; r += 1) {
      if (m[r][c] === runColor) run += 1
      else { if (run >= 5) penalty += 3 + (run - 5); runColor = m[r][c]; run = 1 }
    }
    if (run >= 5) penalty += 3 + (run - 5)
  }
  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const a = m[r][c]
      if (a === m[r][c + 1] && a === m[r + 1][c] && a === m[r + 1][c + 1]) penalty += 3
    }
  }
  // Rule 3: finder-like patterns (simplified)
  const FINDER_A = [true, false, true, true, true, false, true, false, false, false, false]
  const FINDER_B = [false, false, false, false, true, false, true, true, true, false, true]
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size - 10; c += 1) {
      let matchA = true, matchB = true
      for (let i = 0; i < 11; i += 1) {
        if (m[r][c + i] !== FINDER_A[i]) matchA = false
        if (m[r][c + i] !== FINDER_B[i]) matchB = false
      }
      if (matchA || matchB) penalty += 40
    }
  }
  for (let c = 0; c < size; c += 1) {
    for (let r = 0; r < size - 10; r += 1) {
      let matchA = true, matchB = true
      for (let i = 0; i < 11; i += 1) {
        if (m[r + i][c] !== FINDER_A[i]) matchA = false
        if (m[r + i][c] !== FINDER_B[i]) matchB = false
      }
      if (matchA || matchB) penalty += 40
    }
  }
  // Rule 4: dark/light ratio deviation
  let dark = 0
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (m[r][c]) dark += 1
  const pct = (dark * 100) / (size * size)
  const dev = Math.floor(Math.abs(pct - 50) / 5)
  penalty += dev * 10
  return penalty
}

export function qrCodeSvg(input: string, opts: QrOptions = {}): string {
  const utf8Encoder = typeof TextEncoder !== 'undefined'
    ? new TextEncoder()
    : { encode: (s: string) => Uint8Array.from(Buffer.from(s, 'utf-8')) }
  const byteLength = utf8Encoder.encode(input).length
  const version = pickVersion(byteLength)
  const size = sizeForVersion(version)
  const data = buildDataCodewords(input, version)
  const final = interleaveCodewords(data, version)

  // Build base matrix with function patterns.
  const base: Matrix = newMatrix(size)
  placeFinder(base, 0, 0)
  placeFinder(base, 0, size - 7)
  placeFinder(base, size - 7, 0)
  const centers = ALIGNMENT_CENTERS[version - 1]
  for (const r of centers) {
    for (const c of centers) {
      if (base[r]?.[c] !== null && base[r]?.[c] !== undefined) continue
      placeAlignment(base, r, c)
    }
  }
  placeTiming(base)
  placeFormatInfoReserved(base)

  // Build a "reserved" mask — modules that are function/format (not data).
  const reserved: boolean[][] = []
  for (let r = 0; r < size; r += 1) {
    reserved.push(new Array(size).fill(false))
    for (let c = 0; c < size; c += 1) reserved[r][c] = base[r][c] !== null
  }
  const dataMask: boolean[][] = []
  for (let r = 0; r < size; r += 1) {
    dataMask.push(new Array(size).fill(false))
    for (let c = 0; c < size; c += 1) dataMask[r][c] = !reserved[r][c]
  }

  // Place data bits.
  const raw = cloneMatrix(base)
  placeDataBits(raw, final)

  // Pick best mask.
  let bestMask = 0
  let bestPenalty = Infinity
  let bestMatrix = raw
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = cloneMatrix(raw)
    applyMask(candidate, dataMask, mask)
    placeFormatInfo(candidate, mask)
    const penalty = maskPenalty(candidate)
    if (penalty < bestPenalty) { bestPenalty = penalty; bestMask = mask; bestMatrix = candidate }
  }
  void bestMask

  // Render SVG.
  const margin = opts.margin ?? 4
  const px = opts.size ?? 320
  const total = size + margin * 2
  const cell = px / total
  const fg = opts.fg ?? '#000'
  const bg = opts.bg ?? '#fff'
  const rects: string[] = []
  for (let r = 0; r < size; r += 1) {
    let c = 0
    while (c < size) {
      if (bestMatrix[r][c] === true) {
        let run = 1
        while (c + run < size && bestMatrix[r][c + run] === true) run += 1
        const x = (margin + c) * cell
        const y = (margin + r) * cell
        rects.push(`<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${(cell * run).toFixed(3)}" height="${cell.toFixed(3)}"/>`)
        c += run
      } else {
        c += 1
      }
    }
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges">`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
    `<g fill="${fg}">${rects.join('')}</g>`,
    `</svg>`,
  ].join('')
}
