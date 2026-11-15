// Reader routing helpers (spec §4.5, §6.1; design p1-step7-design.md §2, §3.6, §7 items 10, 18,
// 22, 27; P1-1c). Pure: no window, no Next. Safe for server and client components alike: it never
// imports the launch flag (src/config/launch.ts), so a client bundle cannot evaluate it.
import {
  ENABLED_LOCALE_CODES,
  LOCALES,
  isEnabledLocale,
  type LocaleCode,
  type LocaleDef,
} from '../core/locales'

/** The query parameter a gate or switch link carries so the destination saves uiLocale. */
export const REMEMBER_PARAM = 'remember'

/**
 * generateStaticParams for app/(reader)/[locale]: every enabled locale when the reader routes are
 * open, none while gated (with dynamicParams = false every locale path is then a 404).
 */
export function readerLocaleParams(launch: { readonly readerRoutes: boolean }): {
  locale: LocaleCode
}[] {
  return launch.readerRoutes ? ENABLED_LOCALE_CODES.map((locale) => ({ locale })) : []
}

/** The decorative letter inside each gate option, so pre-readers can tell the scripts apart. */
export const SCRIPT_MARKS: Readonly<Record<LocaleDef['script'], string>> = {
  Latn: 'A',
  Deva: 'अ',
  Arab: 'ا',
}

export interface GateOption {
  readonly code: LocaleCode
  /** "/{code}?remember=1": the destination page saves the choice (design §3.6 G1). */
  readonly href: string
  readonly lang: LocaleCode
  readonly hrefLang: LocaleCode
  readonly dir: LocaleDef['dir']
  readonly endonym: string
  /** Decorative (aria-hidden): "A" for Latin, "अ" for Devanagari. */
  readonly mark: string
}

/** One gate option from a registry entry; lang, hrefLang and dir come from the registry. */
export function gateOption(def: LocaleDef): GateOption {
  return {
    code: def.code,
    href: `/${def.code}?${REMEMBER_PARAM}=1`,
    lang: def.code,
    hrefLang: def.code,
    dir: def.dir,
    endonym: def.endonym,
    mark: SCRIPT_MARKS[def.script],
  }
}

/** The gate's options: the enabled locales in registry order. */
export function gateOptions(): GateOption[] {
  return LOCALES.filter((def) => def.status === 'enabled').map(gateOption)
}

/**
 * The same page in another locale: "/en/grown-ups" → "/hi/grown-ups", "/en" → "/hi". A path that
 * does not start with an enabled locale goes to that locale's home.
 */
export function switchHref(pathname: string, target: LocaleCode): string {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname)
  const first = match?.[1]
  if (first === undefined || !isEnabledLocale(first)) return `/${target}`
  return `/${target}${match?.[2] ?? ''}`
}

/** True when the query asks the page to save its locale: exactly one remember, exactly "1". */
export function rememberTarget(search: string): boolean {
  const values = new URLSearchParams(search).getAll(REMEMBER_PARAM)
  return values.length === 1 && values[0] === '1'
}

/** The parameter name of one query part, decoded exactly as URLSearchParams decodes it. */
function partName(part: string): string | undefined {
  return new URLSearchParams(part).keys().next().value
}

/**
 * The URL for history.replaceState after saving: every remember parameter removed, every other
 * query part kept byte for byte and in order, and the hash kept.
 */
export function withoutRemember(pathname: string, search: string, hash: string): string {
  const query = search.startsWith('?') ? search.slice(1) : search
  const kept = query
    .split('&')
    .filter((part) => part !== '' && partName(part) !== REMEMBER_PARAM)
    .join('&')
  return `${pathname}${kept === '' ? '' : `?${kept}`}${hash}`
}
