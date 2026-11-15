// "/" (spec §6.1 language gate; P1 D4, D8; design p1-step7-design.md §1, §3.6, §5.3 item 3, §7
// item 9; P1-1c). Static. While the reader is gated (Production until Step 25b) it is exactly the
// Coming-soon page; in open builds it is the language gate.
import { buildLaunch } from '@/config/launch'
import { ComingSoon } from '@/ui/gate/coming-soon'
import { LanguageGate } from '@/ui/gate/language-gate'

export const dynamic = 'force-static'

export default function GatePage() {
  return buildLaunch().readerRoutes ? <LanguageGate /> : <ComingSoon />
}
