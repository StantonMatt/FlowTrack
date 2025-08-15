'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/components/auth/auth-provider'
import { Toaster } from '@/components/ui/toaster'
import { useState } from 'react'

interface ProvidersProps {
  children: React.ReactNode
  tenantBranding?: {
    name: string
    primaryColor: string
    secondaryColor?: string
    logoUrl?: string
    faviconUrl?: string
  }
  initialUser?: {
    id: string
    email: string
    fullName: string | null
    role: string
    tenantId: string
  }
}

export function Providers({ children, tenantBranding, initialUser }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
            retry: 2,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 1,
          },
        },
      })
  )

  // Apply tenant branding to CSS variables
  if (tenantBranding && typeof document !== 'undefined') {
    const root = document.documentElement
    if (tenantBranding.primaryColor) {
      // Convert hex to HSL for shadcn/ui theming
      const hsl = hexToHSL(tenantBranding.primaryColor)
      root.style.setProperty('--primary', hsl)
    }
    if (tenantBranding.secondaryColor) {
      const hsl = hexToHSL(tenantBranding.secondaryColor)
      root.style.setProperty('--secondary', hsl)
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}

// Helper function to convert hex to HSL
function hexToHSL(hex: string): string {
  // Remove the hash if present
  hex = hex.replace('#', '')

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  // Find min and max values
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  // Convert to CSS HSL format
  const hue = Math.round(h * 360)
  const saturation = Math.round(s * 100)
  const lightness = Math.round(l * 100)

  return `${hue} ${saturation}% ${lightness}%`
}