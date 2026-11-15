// A no-op Next.js deployment adapter for CI (P1 retrospective item M8; the P1-1c U2 escape).
// Setting NEXT_ADAPTER_PATH to this file makes `next build` write the output layout it writes
// under Vercel's own adapter (prerendered pages under .next/server/route-cache), so the build and
// check-build are proven on that layout before Vercel builds Production. It writes nothing and
// changes no output; it only makes Next run in adapter mode ("Running onBuildComplete from
// noop-adapter" in the build log).
module.exports = {
  name: 'noop-adapter',
  async onBuildComplete() {},
}
