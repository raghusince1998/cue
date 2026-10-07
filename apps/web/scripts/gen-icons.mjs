import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Writes the PWA icons with no image dependencies — the manifest needs real
 * PNGs (Chrome will not treat an SVG-only manifest as installable) and pulling
 * in sharp for two flat shapes is not worth the install cost.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0 // filter: none
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
      offset += 4
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const NAVY = [15, 23, 42, 255]
const BLUE = [59, 130, 246, 255]

/** A filled dot inside a ring — the same mark the app header uses. */
function mark(x, y, size) {
  const cx = size / 2
  const cy = size / 2
  const d = Math.hypot(x - cx, y - cy)

  if (d <= size * 0.17) return BLUE

  const ringR = size * 0.3
  const ringW = size * 0.045
  if (Math.abs(d - ringR) <= ringW / 2) return BLUE

  return NAVY
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../public')
mkdirSync(outDir, { recursive: true })

for (const size of [192, 512]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), png(size, mark))
  console.log(`wrote public/icon-${size}.png`)
}
