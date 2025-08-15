'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/stores/auth-store'
import { UserRole } from '@/types/models'
import { Permission } from '@/lib/auth/rbac'

interface AuthGuardProps {
  children: React.ReactNode
  requireAuth?: boolean
  requireRole?: UserRole
  requirePermission?: Permission
  fallback?: React.ReactNode
  redirectTo?: string
}

export function AuthGuard({
  children,
  requireAuth = true,
  requireRole,
  requirePermission,
  fallback,
  redirectTo = '/login'
}: AuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, isInitialized, role, hasPermission, hasRole } = useAuth()
  const [isAuthorized, setIsAuthorized] = useState(false)

  useEffect(() => {
    if (!isInitialized) return

    // Check authentication requirement
    if (requireAuth && !isAuthenticated) {
      const returnUrl = encodeURIComponent(pathname)
      router.push(`${redirectTo}?returnUrl=${returnUrl}`)
      return
    }

    // Check role requirement
    if (requireRole && !hasRole(requireRole)) {
      setIsAuthorized(false)
      return
    }

    // Check permission requirement
    if (requirePermission && !hasPermission(requirePermission)) {
      setIsAuthorized(false)
      return
    }

    setIsAuthorized(true)
  }, [
    isInitialized,
    isAuthenticated,
    requireAuth,
    requireRole,
    requirePermission,
    hasPermission,
    hasRole,
    router,
    pathname,
    redirectTo
  ])

  // Show loading state while checking auth
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // Show fallback or unauthorized message if not authorized
  if (requireAuth && !isAuthorized) {
    if (fallback) {
      return <>{fallback}</>
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p className="text-muted-foreground mb-8">
          You do not have permission to access this page.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  return <>{children}</>
}