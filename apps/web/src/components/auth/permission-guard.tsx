'use client'

import { useAuth } from '@/stores/auth-store'
import { Permission } from '@/lib/auth/rbac'

interface PermissionGuardProps {
  children: React.ReactNode
  permission?: Permission
  permissions?: Permission[] // For OR condition
  requireAll?: boolean // For AND condition when multiple permissions
  fallback?: React.ReactNode
}

export function PermissionGuard({
  children,
  permission,
  permissions,
  requireAll = false,
  fallback = null
}: PermissionGuardProps) {
  const { hasPermission } = useAuth()

  // Check single permission
  if (permission) {
    if (!hasPermission(permission)) {
      return <>{fallback}</>
    }
    return <>{children}</>
  }

  // Check multiple permissions
  if (permissions && permissions.length > 0) {
    const hasAccess = requireAll
      ? permissions.every(p => hasPermission(p))
      : permissions.some(p => hasPermission(p))

    if (!hasAccess) {
      return <>{fallback}</>
    }
  }

  return <>{children}</>
}

// Convenience component for showing/hiding UI elements based on permissions
export function Can({
  children,
  permission,
  not = false
}: {
  children: React.ReactNode
  permission: Permission
  not?: boolean // Invert the check
}) {
  const { hasPermission } = useAuth()
  const hasAccess = hasPermission(permission)
  
  if (not ? !hasAccess : hasAccess) {
    return <>{children}</>
  }
  
  return null
}