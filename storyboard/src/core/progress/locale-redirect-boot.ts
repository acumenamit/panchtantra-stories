// The gate's returning-visitor redirect (P1 D8 G1; design p1-step7-design.md §3.6, §7 item 21;
// P1-1c). One blocking inline script in the <head> of "/", rendered only in open builds, after the
// text-size boot script. Pure: the script is only a string here.
// - It acts only on a normal navigation (navigation type "navigate"), never on Back, Forward,
//   reload or prerender, so the gate never bounces.
// - It mirrors what readPrefs decides about uiLocale (records.ts): unreadable JSON, a top level
//   that is not a plain object, any schema other than RECORD_SCHEMA, or an own "__proto__" key up
//   to depth 64 (the same walk as text-scale-boot.ts) all mean "not chosen"; otherwise uiLocale
//   when it is exactly an enabled UI locale (UI_LOCALES that the registry enables). Then
//   location.replace('/' + uiLocale), so the gate leaves no history entry.
// - try/catch around everything; it never writes (opening a page never writes, spec §6.3).
// - ES5, under 1 KB, no "</script", "<!--" or backtick. Its SHA-256 is pinned in the test only:
//   never in the CSP, where a hash would make browsers ignore 'unsafe-inline'.
import { ENABLED_LOCALE_CODES } from '../locales'
import { PREFS_KEY, RECORD_SCHEMA, UI_LOCALES } from './records'

/** The uiLocale values the script follows: UI_LOCALES ∩ ENABLED_LOCALE_CODES, in UI_LOCALES order. */
export const REDIRECT_LOCALES: readonly string[] = UI_LOCALES.filter((code) =>
  ENABLED_LOCALE_CODES.includes(code),
)

const followed =
  REDIRECT_LOCALES.length === 0
    ? 'false'
    : REDIRECT_LOCALES.map((code) => `u===${JSON.stringify(code)}`).join('||')

export const LOCALE_REDIRECT_SCRIPT =
  '(function(){try{' +
  'var n=performance.getEntriesByType("navigation")[0];if(!n||n.type!=="navigate")return;' +
  `var r=localStorage.getItem(${JSON.stringify(PREFS_KEY)});if(r===null)return;` +
  'var v=JSON.parse(r);' +
  `if(!v||typeof v!=="object"||Array.isArray(v)||v.schema!==${RECORD_SCHEMA}||p(v,0))return;` +
  'var u=v.uiLocale;' +
  `if(${followed})location.replace("/"+u)` +
  '}catch(e){}' +
  // p: an own "__proto__" key anywhere up to depth 64, as hasOwnProtoKey in package/v1.ts.
  'function p(x,d){if(d>64||x===null||typeof x!=="object")return false;' +
  'var o=Object.prototype.hasOwnProperty;' +
  'if(Array.isArray(x)){for(var i=0;i<x.length;i++)if(p(x[i],d+1))return true;return false}' +
  'if(o.call(x,"__proto__"))return true;' +
  'for(var k in x)if(o.call(x,k)&&p(x[k],d+1))return true;return false}' +
  '})()'
