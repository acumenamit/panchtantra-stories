// Vitest stand-in for the 'server-only' marker (design p1-step7-design.md §2, §3.12 #22; P1-1c).
// Next resolves the real marker itself at build (no install); Vitest cannot, so vitest.config.mts
// aliases 'server-only' to this empty module. Never imported by app code.
export {}
