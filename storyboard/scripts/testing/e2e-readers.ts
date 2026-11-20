// The pure readers the Step 12 e2e specs share (design p1-step12-design.md §13.2 W2, W3, W11; P1-3
// Step 12a), unit-tested in e2e-readers.test.ts (T12-38). A leaf module: it imports nothing, so any
// spec may load it and the e2e reach walk (staging-catalogue.test.ts) finds no builder behind it.
// - W2: measureBoxes runs in the page (page.evaluate sends its source, so it names nothing from this
//   module) and reads each selector's boxes in page coordinates, plus the document's scroll size;
//   boxDifferences and equalBoxes compare two such sets with a 0.01 px tolerance (13.1 I).
// - W3: orderByRule, the shelf order by its rule: addedOn descending, then the id in code units
//   (design §3.2 N3), never localeCompare.
// - W11: pixelStats, per named region the mean absolute error and the largest absolute error of
//   each RGB channel between a decoded image and its reference (the og image check, 12b).

/** One element's box in page coordinates (CSS px). */
export interface BoxRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Each selector's boxes, one per matching element in document order. */
export type BoxSet = Readonly<Record<string, readonly BoxRect[]>>

/** Two boxes are the same when every field differs by at most this much (design §13.1 I). */
export const BOX_TOLERANCE_PX = 0.01

/** The key under which measureBoxes records the document's scroll width and height. */
export const SCROLL_SIZE_KEY = '(document scroll size)'

/**
 * In the page: every element each selector matches, its getBoundingClientRect moved to page
 * coordinates, and under '(document scroll size)' the scrolling element's scroll width and height.
 * Self-contained: page.evaluate sends it as source text.
 */
export function measureBoxes(selectors: readonly string[]): Record<string, BoxRect[]> {
  const boxes: Record<string, BoxRect[]> = {}
  for (const selector of selectors) {
    boxes[selector] = [...document.querySelectorAll(selector)].map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      }
    })
  }
  const scrolling = document.scrollingElement ?? document.documentElement
  boxes['(document scroll size)'] = [
    { left: 0, top: 0, width: scrolling.scrollWidth, height: scrolling.scrollHeight },
  ]
  return boxes
}

const FIELDS = ['left', 'top', 'width', 'height'] as const

/** Every way `b` differs from `a`, one line each (empty when they are equal). */
export function boxDifferences(a: BoxSet, b: BoxSet): string[] {
  const differences: string[] = []
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  for (const key of keys) {
    const first = a[key]
    const second = b[key]
    if (first === undefined || second === undefined) {
      differences.push(`${key}: ${first === undefined ? 'missing first' : 'missing then'}`)
      continue
    }
    if (first.length !== second.length) {
      differences.push(`${key}: ${first.length} boxes, then ${second.length}`)
      continue
    }
    first.forEach((box, index) => {
      const other = second[index]
      if (other === undefined) return
      for (const field of FIELDS) {
        if (Math.abs(box[field] - other[field]) > BOX_TOLERANCE_PX) {
          differences.push(`${key} #${index} ${field}: ${box[field]} then ${other[field]}`)
        }
      }
    })
  }
  return differences
}

/** Whether two box sets are the same (design §13.1 I). */
export function equalBoxes(a: BoxSet, b: BoxSet): boolean {
  return boxDifferences(a, b).length === 0
}

/** One shelf card as the page shows it: its story id and its data-added-on. */
export interface RuleCard {
  readonly id: string
  readonly addedOn: string
}

/** The ids of `cards` in the shelf's order: addedOn descending, then the id in code units. */
export function orderByRule(cards: readonly RuleCard[]): string[] {
  return [...cards]
    .sort((x, y) => {
      if (x.addedOn !== y.addedOn) return x.addedOn < y.addedOn ? 1 : -1
      if (x.id === y.id) return 0
      return x.id < y.id ? -1 : 1
    })
    .map((card) => card.id)
}

/** An image's pixels: RGB (3) or RGBA (4) bytes per pixel, row by row. */
export interface PixelImage {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly data: ArrayLike<number>
}

/** A rectangle of pixels. */
export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One region's statistics, per RGB channel. */
export interface RegionStats {
  readonly pixels: number
  readonly mae: readonly [number, number, number]
  readonly maxAbs: readonly [number, number, number]
}

/**
 * Per named region (one or more rectangles, counted once each), the mean absolute error and the
 * largest absolute error of each RGB channel of `decoded` against `reference`. Alpha is not read.
 */
export function pixelStats(
  decoded: PixelImage,
  reference: PixelImage,
  regions: Readonly<Record<string, readonly Region[]>>,
): Record<string, RegionStats> {
  if (decoded.width !== reference.width || decoded.height !== reference.height) {
    throw new Error(
      `pixelStats: ${decoded.width}×${decoded.height} against ${reference.width}×${reference.height}`,
    )
  }
  const out: Record<string, RegionStats> = {}
  for (const [name, rects] of Object.entries(regions)) {
    const sums = [0, 0, 0]
    const maxes = [0, 0, 0]
    let pixels = 0
    for (const rect of rects) {
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          const at = y * decoded.width + x
          for (let channel = 0; channel < 3; channel++) {
            const delta = Math.abs(
              (decoded.data[at * decoded.channels + channel] ?? 0) -
                (reference.data[at * reference.channels + channel] ?? 0),
            )
            sums[channel] = (sums[channel] ?? 0) + delta
            maxes[channel] = Math.max(maxes[channel] ?? 0, delta)
          }
          pixels++
        }
      }
    }
    const mean = (channel: number): number => (pixels === 0 ? 0 : (sums[channel] ?? 0) / pixels)
    out[name] = {
      pixels,
      mae: [mean(0), mean(1), mean(2)],
      maxAbs: [maxes[0] ?? 0, maxes[1] ?? 0, maxes[2] ?? 0],
    }
  }
  return out
}
