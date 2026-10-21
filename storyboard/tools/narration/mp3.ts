// Minimal MP3 frame scanner (read-only): bitrate, sample rate, channel mode and exact duration.
const BITRATES: Record<1 | 2, number[]> = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const RATES: Record<1 | 2 | 25, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
}

export interface Mp3Info {
  readonly frames: number
  readonly kbps: readonly number[]
  readonly sampleRate: number
  readonly mono: boolean
  readonly durationMs: number
}

export function mp3Info(buf: Uint8Array): Mp3Info {
  let i = 0
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    i =
      10 +
      (((buf[6]! & 127) << 21) | ((buf[7]! & 127) << 14) | ((buf[8]! & 127) << 7) | (buf[9]! & 127))
  }
  let frames = 0
  let samples = 0
  let sampleRate = 0
  let mono = true
  const kbps = new Set<number>()
  while (i + 4 <= buf.length) {
    const b1 = buf[i + 1]!
    const b2 = buf[i + 2]!
    if (buf[i] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      i++
      continue
    }
    const verBits = (b1 >> 3) & 3
    const ver = verBits === 3 ? 1 : verBits === 2 ? 2 : verBits === 0 ? 25 : 0
    const layer = (b1 >> 1) & 3
    const bri = b2 >> 4
    const sri = (b2 >> 2) & 3
    if (!ver || layer !== 1 || bri === 0 || bri === 15 || sri === 3) {
      i++
      continue
    }
    const rate = RATES[ver][sri]!
    const kb = BITRATES[ver === 1 ? 1 : 2][bri]!
    const spf = ver === 1 ? 1152 : 576
    const len = Math.floor(((spf / 8) * kb * 1000) / rate) + ((b2 >> 1) & 1)
    const tag = String.fromCharCode(...buf.subarray(i + 4, i + 44))
    if (!(frames === 0 && /Xing|Info/.test(tag))) {
      frames++
      samples += spf
      kbps.add(kb)
      if (buf[i + 3]! >> 6 !== 3) mono = false
    }
    sampleRate = rate
    i += len
  }
  return {
    frames,
    kbps: [...kbps],
    sampleRate,
    mono,
    durationMs: sampleRate ? Math.round((samples / sampleRate) * 1000) : 0,
  }
}
