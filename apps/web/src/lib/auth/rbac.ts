import { UserRole } from '@/types/models'

// Permission structure: resource:action
// Wildcards: * means all
export type Permission = 
  | 'customers:read'
  | 'customers:write'
  | 'customers:delete'
  | 'readings:read'
  | 'readings:write'
  | 'readings:delete'
  | 'billing:read'
  | 'billing:write'
  | 'billing:delete'
  | 'invoices:read'
  | 'invoices:write'
  | 'invoices:delete'
  | 'payments:read'
  | 'payments:write'
  | 'reports:read'
  | 'reports:write'
  | 'settings:read'
  | 'settings:write'
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'audit:read'
  | '*' // Super admin permission

// Role-based permission mappings
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ['*'], // Admins have all permissions
  
  manager: [
    'customers:read', 'customers:write', 'customers:delete',
    'readings:read', 'readings:write', 'readings:delete',
    'billing:read', 'billing:write', 'billing:delete',
    'invoices:read', 'invoices:write', 'invoices:delete',
    'payments:read', 'payments:write',
    'reports:read', 'reports:write',
    'settings:read',
    'users:read',
    'audit:read'
  ],
  
  operator: [
    'customers:read', 'customers:write',
    'readings:read', 'readings:write',
    'billing:read',
    'invoices:read',
    'payments:read',
    'reports:read'
  ],
  
  viewer: [
    'customers:read',
    'readings:read',
    'billing:read',
    'invoices:read',
    'payments:read',
    'reports:read'
  ]
}

/**
 * Check if a role has a specific permission
 * @param role - User's role
 * @param permission - Required permission
 * @returns true if the role has the permission
 */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false
  
  const rolePermissions = ROLE_PERMISSIONS[role]
  if (!rolePermissions) return false
  
  // Check for super admin
  if (rolePermissions.includes('*')) return true
  
  // Check for exact permission
  if (rolePermissions.includes(permission)) return true
  
  // Check for wildcard permissions (e.g., customers:* matches customers:read, customers:write, etc.)
  const [resource, action] = permission.split(':')
  const wildcardPermission = `${resource}:*` as Permission
  
  return rolePermissions.some(p => {
    if (p === wildcardPermission) return true
    
    // Check if permission starts with a wildcard pattern
    if (p.endsWith(':*')) {
      const pResource = p.split(':')[0]
      return resource === pResource
    }
    
    return false
  })
}

/**
 * Check if a role can perform any of the specified permissions
 * @param role - User's role
 * @param permissions - Array of permissions (OR condition)
 * @returns true if the role has any of the permissions
 */
export function canAny(role: UserRole | null | undefined, permissions: Permission[]): boolean {
  return permissions.some(permission => can(role, permission))
}

/**
 * Check if a role can perform all of the specified permissions
 * @param role - User's role
 * @param permissions - Array of permissions (AND condition)
 * @returns true if the role has all of the permissions
 */
export function canAll(role: UserRole | null | undefined, permissions: Permission[]): boolean {
  return permissions.every(permission => can(role, permission))
}

/**
 * Get all permissions for a role
 * @param role - User's role
 * @returns Array of permissions
 */
export function getPermissions(role: UserRole | null | undefined): Permission[] {
  if (!role) return []
  return ROLE_PERMISSIONS[role] || []
}

/**
 * Check if a role is higher or equal in hierarchy
 * @param userRole - User's current role
 * @param requiredRole - Minimum required role
 * @returns true if user role meets or exceeds required role
 */
export function hasRole(userRole: UserRole | null | undefined, requiredRole: UserRole): boolean {
  if (!userRole) return false
  
  const roleHierarchy: Record<UserRole, number> = {
    admin: 4,
    manager: 3,
    operator: 2,
    viewer: 1
  }
  
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
}

/**
 * Get display name for a role
 * @param role - User's role
 * @returns Display name
 */
export function getRoleDisplayName(role: UserRole): string {
  const displayNames: Record<UserRole, string> = {
    admin: 'Administrator',
    manager: 'Manager',
    operator: 'Operator',
    viewer: 'Viewer'
  }
  
  return displayNames[role] || role
}

/**
 * Get role description
 * @param role - User's role
 * @returns Role description
 */
export function getRoleDescription(role: UserRole): string {
  const descriptions: Record<UserRole, string> = {
    admin: 'Full system access and configuration',
    manager: 'Manage customers, billing, and reports',
    operator: 'Record readings and manage customers',
    viewer: 'Read-only access to data'
  }
  
  return descriptions[role] || ''
}