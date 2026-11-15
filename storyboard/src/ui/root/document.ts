// The <html> attributes every root layout renders (spec §4.5, §6.6 3.1.1; design
// p1-step7-design.md §4.1, §4.2; P1-1c). Pure, so unit tests can import it: the font classes are
// passed in (src/ui/root/font-classes.ts imports next/font, which only runs inside Next).
// lang and dir always come from the URL's locale and the registry, never from storage.
import type { LocaleDef } from '../../core/locales'

export interface HtmlAttributes {
  readonly lang: LocaleDef['code']
  readonly dir: LocaleDef['dir']
  readonly className: string
  /** The text-size boot script sets data-text-scale on <html> before React hydrates. */
  readonly suppressHydrationWarning: true
}

export function htmlAttributes(def: LocaleDef, fontClasses: string): HtmlAttributes {
  return { lang: def.code, dir: def.dir, className: fontClasses, suppressHydrationWarning: true }
}
