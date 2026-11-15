// "/" while the reader is gated (P1 D4; design p1-step7-design.md §1, §5.4, §6.4, §7 item 9;
// P1-1c): exactly the pre-Step 7 markup, <main><h1>Storyboard</h1><p>Coming soon.</p></main>, with
// no class names, so Production's page stays the same. "Coming soon." is a literal, not a message.
import { APP_NAME } from '../../core/app-info'

export function ComingSoon() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>Coming soon.</p>
    </main>
  )
}
