// Web manifest route (spec §6.8; P1-1b): /manifest.webmanifest. The values live in src/ui/manifest.ts.
import type { MetadataRoute } from 'next'
import { webManifest } from '@/ui/manifest'

export default function manifest(): MetadataRoute.Manifest {
  return webManifest()
}
