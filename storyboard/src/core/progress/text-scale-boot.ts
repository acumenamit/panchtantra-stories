// Text size at first paint (spec §6.3 prefs, §6.6 resize; P1-1b). One blocking inline script in the
// root layout's <head> reads reader.v1.prefs and sets data-text-scale on <html> before <body> is
// parsed, so readers at 125% or 150% never see a jump. Pure: the script is only a string here.
// - It mirrors what readPrefs decides about the text size (records.ts): unreadable JSON, any schema
//   other than RECORD_SCHEMA (a newer whole-number schema means memory defaults), an own
//   "__proto__" key up to depth 64 (package/v1.ts hasOwnProtoKey) or a wrong top level all mean
//   the default; otherwise the record's textScale when it is a non-default TEXT_SCALES value.
// - try/catch around every access; it never writes (spec §6.3). The default sets no attribute.
// - ES5, under 1 KB, no "</script", "<!--" or backtick. Its SHA-256 is pinned in the test only:
//   never in the CSP, where a hash would make browsers ignore 'unsafe-inline'.
import { DEFAULT_PREFS, PREFS_KEY, RECORD_SCHEMA, TEXT_SCALES } from './records'

export const TEXT_SCALE_ATTRIBUTE = 'data-text-scale'

const nonDefaultScales = TEXT_SCALES.filter((scale) => scale !== DEFAULT_PREFS.textScale)

export const TEXT_SCALE_BOOT_SCRIPT =
  '(function(){try{' +
  `var r=localStorage.getItem(${JSON.stringify(PREFS_KEY)});if(r===null)return;` +
  'var v=JSON.parse(r);' +
  `if(!v||typeof v!=="object"||Array.isArray(v)||v.schema!==${RECORD_SCHEMA}||p(v,0))return;` +
  'var s=v.textScale;' +
  `if(${nonDefaultScales.map((scale) => `s===${scale}`).join('||')})` +
  `document.documentElement.setAttribute(${JSON.stringify(TEXT_SCALE_ATTRIBUTE)},""+s)` +
  '}catch(e){}' +
  // p: an own "__proto__" key anywhere up to depth 64, as hasOwnProtoKey in package/v1.ts.
  'function p(x,d){if(d>64||x===null||typeof x!=="object")return false;' +
  'var o=Object.prototype.hasOwnProperty;' +
  'if(Array.isArray(x)){for(var i=0;i<x.length;i++)if(p(x[i],d+1))return true;return false}' +
  'if(o.call(x,"__proto__"))return true;' +
  'for(var k in x)if(o.call(x,k)&&p(x[k],d+1))return true;return false}' +
  '})()'
