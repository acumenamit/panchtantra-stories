import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Spec §10.2: Cache Components stays off; pages are rebuilt on publish.
  cacheComponents: false,
  poweredByHeader: false,
}

export default nextConfig
