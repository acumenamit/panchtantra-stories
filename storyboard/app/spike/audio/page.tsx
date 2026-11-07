// P0-13 THROWAWAY: removed at cleanup
// Device test page for spikes S-2 and S-3 (plan file 13). Prerendered, noindex, not linked.
// - A meta CSP equal to spec §9 with the project ref filled in. React hoists the <meta> into <head>.
//   Browsers ignore frame-ancestors in a meta CSP (plan §10 item 7); it stays for fidelity.
// - An inline script records securitypolicyviolation events. A page cannot put an inline script in
//   <head> in the App Router (next/script beforeInteractive runs from Next's runtime, not the
//   parser), so it is the first element of <body>, before any content that could be blocked.
import type { Metadata } from 'next'
import { AudioHarness } from './AudioHarness'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Spike audio',
  robots: { index: false, follow: false },
}

const SUPABASE_ORIGIN = 'https://wlunxatrekiqygwphkgy.supabase.co'

/** Spec §9, in order. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' ${SUPABASE_ORIGIN}`,
  `media-src 'self' ${SUPABASE_ORIGIN}`,
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

// Plain ES5 so it runs on any browser before hydration. The harness reads window.__spikeCsp later.
const CSP_RECORDER = `(function(){var s={list:[],notify:null};window.__spikeCsp=s;
document.addEventListener('securitypolicyviolation',function(e){
var t=function(v){return String(v||'').slice(0,200)};
s.list.push({at:Math.round(performance.now()),directive:t(e.effectiveDirective||e.violatedDirective),
blockedURI:t(e.blockedURI),sourceFile:t(e.sourceFile),lineNumber:e.lineNumber||0,
disposition:t(e.disposition),sample:t(e.sample)});
if(typeof s.notify==='function')s.notify();});})();`

const STYLE = `.spike-pulse{animation:spike-pulse 1s ease-in-out infinite}
@keyframes spike-pulse{50%{transform:scale(1.08)}}
@media (prefers-reduced-motion:reduce){.spike-pulse{animation:none;outline:4px solid currentColor}}`

export default function SpikeAudioPage() {
  return (
    <>
      <meta httpEquiv="Content-Security-Policy" content={CSP} />
      <script dangerouslySetInnerHTML={{ __html: CSP_RECORDER }} />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <main style={{ maxWidth: 960, padding: 8 }}>
        <h1>Spike: audio on devices (S-2, S-3)</h1>
        <p>Narration: AI voice (AI4Bharat Indic Parler-TTS). Temporary test page.</p>
        <AudioHarness />
      </main>
    </>
  )
}
