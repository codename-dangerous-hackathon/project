import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Anchor Companion',
    short_name: 'Anchor',
    description: 'A 100% on-device AI companion that helps people with dementia recognize loved ones.',
    start_url: '/patient',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192x192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'maskable'
      },
      {
        src: '/icon-512x512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any'
      },
    ],
    screenshots: [
      {
        src: '/screenshot-mobile.svg',
        sizes: '1080x1920',
        type: 'image/svg+xml',
      },
      {
        src: '/screenshot-desktop.svg',
        sizes: '1920x1080',
        type: 'image/svg+xml',
        form_factor: 'wide',
      } as any
    ],
  }
}
