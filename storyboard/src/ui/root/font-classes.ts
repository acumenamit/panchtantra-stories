// The three next/font .variable classes on every root layout's <html> (spec §6.7 Fonts; design
// p1-step7-design.md §4.1; P1-1c). tokens.css builds --font-latin and --font-hindi from them.
// Never imported by a unit test: outside Next's compiler next/font/local is an empty module, so
// src/ui/fonts throws at import there (the fonts test reads that file as text instead).
import { devanagari, devanagariLatin, lora } from '../fonts'

export const FONT_CLASSES = [lora.variable, devanagari.variable, devanagariLatin.variable].join(' ')
