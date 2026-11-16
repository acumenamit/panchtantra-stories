// Text size after first paint (Step 10b; design p1-step10-design.md D11-P20, R23; spec §6.3 prefs,
// §6.6 resize). The boot script (text-scale-boot.ts) sets data-text-scale on <html> before the first
// paint; the player's TextScaleSync keeps it in step with the prefs afterwards (a radio in the menu,
// another tab), through this function.
// - textScaleAttributeOf(scale): the attribute value for a text size, or null when <html> carries
//   none. It agrees with what TEXT_SCALE_BOOT_SCRIPT sets for the same stored textScale (parity
//   test): '125' and '150' for the non-default TEXT_SCALES values, null for the default (100) and
//   for anything else. Null means "remove the attribute", which the boot script never needs to do
//   (it runs once on a fresh <html>) but a later sync does when the reader goes back to 100.
// Pure: no DOM, no storage. Additive: text-scale-boot.ts is unchanged.
import { DEFAULT_PREFS, TEXT_SCALES } from './records'

export { TEXT_SCALE_ATTRIBUTE } from './text-scale-boot'

const nonDefaultScales: readonly number[] = TEXT_SCALES.filter(
  (scale) => scale !== DEFAULT_PREFS.textScale,
)

/** The data-text-scale value for a text size: '125', '150', or null (no attribute). */
export function textScaleAttributeOf(scale: unknown): string | null {
  return typeof scale === 'number' && nonDefaultScales.includes(scale) ? String(scale) : null
}
