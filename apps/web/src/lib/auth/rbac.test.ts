import { describe, it, expect } from 'vitest'
import { can, canAny, canAll, hasRole, getPermissions } from './rbac'
import { UserRole } from '@/types/models'

describe('RBAC - Role-Based Access Control', () => {
  describe('can() - Permission checking', () => {
    it('should grant all permissions to admin role', () => {
      expect(can('admin', 'customers:read')).toBe(true)
      expect(can('admin', 'customers:write')).toBe(true)
      expect(can('admin', 'customers:delete')).toBe(true)
      expect(can('admin', 'settings:write')).toBe(true)
      expect(can('admin', 'audit:read')).toBe(true)
    })

    it('should grant correct permissions to manager role', () => {
      expect(can('manager', 'customers:read')).toBe(true)
      expect(can('manager', 'customers:write')).toBe(true)
      expect(can('manager', 'customers:delete')).toBe(true)
      expect(can('manager', 'billing:write')).toBe(true)
      expect(can('manager', 'reports:write')).toBe(true)
      expect(can('manager', 'settings:read')).toBe(true)
      
      // Should not have these permissions
      expect(can('manager', 'settings:write')).toBe(false)
      expect(can('manager', 'users:write')).toBe(false)
      expect(can('manager', 'users:delete')).toBe(false)
    })

    it('should grant correct permissions to operator role', () => {
      expect(can('operator', 'customers:read')).toBe(true)
      expect(can('operator', 'customers:write')).toBe(true)
      expect(can('operator', 'readings:read')).toBe(true)
      expect(can('operator', 'readings:write')).toBe(true)
      expect(can('operator', 'billing:read')).toBe(true)
      
      // Should not have these permissions
      expect(can('operator', 'customers:delete')).toBe(false)
      expect(can('operator', 'billing:write')).toBe(false)
      expect(can('operator', 'settings:read')).toBe(false)
      expect(can('operator', 'users:read')).toBe(false)
    })

    it('should grant only read permissions to viewer role', () => {
      expect(can('viewer', 'customers:read')).toBe(true)
      expect(can('viewer', 'readings:read')).toBe(true)
      expect(can('viewer', 'billing:read')).toBe(true)
      expect(can('viewer', 'invoices:read')).toBe(true)
      
      // Should not have write or delete permissions
      expect(can('viewer', 'customers:write')).toBe(false)
      expect(can('viewer', 'customers:delete')).toBe(false)
      expect(can('viewer', 'readings:write')).toBe(false)
      expect(can('viewer', 'settings:write')).toBe(false)
    })

    it('should return false for null or undefined role', () => {
      expect(can(null, 'customers:read')).toBe(false)
      expect(can(undefined, 'customers:read')).toBe(false)
    })

    it('should return false for invalid role', () => {
      expect(can('invalid' as UserRole, 'customers:read')).toBe(false)
    })
  })

  describe('canAny() - OR permission checking', () => {
    it('should return true if any permission is granted', () => {
      expect(canAny('viewer', ['customers:read', 'customers:write'])).toBe(true)
      expect(canAny('operator', ['settings:write', 'customers:write'])).toBe(true)
    })

    it('should return false if no permissions are granted', () => {
      expect(canAny('viewer', ['customers:write', 'customers:delete'])).toBe(false)
      expect(canAny('operator', ['settings:write', 'users:write'])).toBe(false)
    })

    it('should handle empty permission array', () => {
      expect(canAny('admin', [])).toBe(false)
    })
  })

  describe('canAll() - AND permission checking', () => {
    it('should return true if all permissions are granted', () => {
      expect(canAll('admin', ['customers:read', 'customers:write', 'customers:delete'])).toBe(true)
      expect(canAll('manager', ['customers:read', 'billing:write', 'reports:read'])).toBe(true)
    })

    it('should return false if any permission is not granted', () => {
      expect(canAll('viewer', ['customers:read', 'customers:write'])).toBe(false)
      expect(canAll('operator', ['customers:write', 'settings:write'])).toBe(false)
    })

    it('should handle empty permission array', () => {
      expect(canAll('admin', [])).toBe(true)
    })
  })

  describe('hasRole() - Role hierarchy checking', () => {
    it('should correctly check role hierarchy', () => {
      // Admin has all roles
      expect(hasRole('admin', 'admin')).toBe(true)
      expect(hasRole('admin', 'manager')).toBe(true)
      expect(hasRole('admin', 'operator')).toBe(true)
      expect(hasRole('admin', 'viewer')).toBe(true)
      
      // Manager
      expect(hasRole('manager', 'admin')).toBe(false)
      expect(hasRole('manager', 'manager')).toBe(true)
      expect(hasRole('manager', 'operator')).toBe(true)
      expect(hasRole('manager', 'viewer')).toBe(true)
      
      // Operator
      expect(hasRole('operator', 'admin')).toBe(false)
      expect(hasRole('operator', 'manager')).toBe(false)
      expect(hasRole('operator', 'operator')).toBe(true)
      expect(hasRole('operator', 'viewer')).toBe(true)
      
      // Viewer
      expect(hasRole('viewer', 'admin')).toBe(false)
      expect(hasRole('viewer', 'manager')).toBe(false)
      expect(hasRole('viewer', 'operator')).toBe(false)
      expect(hasRole('viewer', 'viewer')).toBe(true)
    })

    it('should return false for null or undefined role', () => {
      expect(hasRole(null, 'viewer')).toBe(false)
      expect(hasRole(undefined, 'viewer')).toBe(false)
    })
  })

  describe('getPermissions() - Get all permissions for a role', () => {
    it('should return all permissions for admin', () => {
      const permissions = getPermissions('admin')
      expect(permissions).toContain('*')
      expect(permissions.length).toBe(1)
    })

    it('should return correct permissions for manager', () => {
      const permissions = getPermissions('manager')
      expect(permissions).toContain('customers:read')
      expect(permissions).toContain('customers:write')
      expect(permissions).toContain('customers:delete')
      expect(permissions).toContain('billing:write')
      expect(permissions).toContain('reports:write')
      expect(permissions).not.toContain('settings:write')
    })

    it('should return correct permissions for operator', () => {
      const permissions = getPermissions('operator')
      expect(permissions).toContain('customers:read')
      expect(permissions).toContain('customers:write')
      expect(permissions).toContain('readings:write')
      expect(permissions).not.toContain('customers:delete')
      expect(permissions).not.toContain('billing:write')
    })

    it('should return correct permissions for viewer', () => {
      const permissions = getPermissions('viewer')
      expect(permissions.every(p => p.endsWith(':read'))).toBe(true)
      expect(permissions).not.toContain('customers:write')
      expect(permissions).not.toContain('customers:delete')
    })

    it('should return empty array for null or undefined role', () => {
      expect(getPermissions(null)).toEqual([])
      expect(getPermissions(undefined)).toEqual([])
    })
  })

  describe('Wildcard permission matching', () => {
    it('should match wildcard permissions correctly', () => {
      // Admin with * should match everything
      expect(can('admin', 'anything:anything')).toBe(true)
      
      // Test resource wildcards (if implemented)
      // For now, our implementation doesn't have resource wildcards for non-admin roles
      // But the logic is there to support it
    })
  })
})