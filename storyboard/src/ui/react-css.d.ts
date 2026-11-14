// Custom properties in JSX style (spec §6.7 RC-12; P1-1b). ESLint lets an inline style set only
// custom properties (style={{ '--x': ... }}), and React's CSSProperties has no index signature, so
// this augmentation types them. Never a cast: `as CSSProperties` is rejected by the JSX style rule.
// The import makes this file a module, so it augments React's types instead of redeclaring them.
import 'react'

declare module 'react' {
  interface CSSProperties {
    [name: `--${string}`]: string | number | undefined
  }
}
