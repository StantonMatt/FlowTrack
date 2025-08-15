import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { User as AuthUser } from '@supabase/supabase-js'
import { User as DbUser, Tenant, UserRole } from '@/types/models'

interface AuthState {
  // Auth state
  authUser: AuthUser | null
  dbUser: DbUser | null
  tenant: Tenant | null
  session: {
    accessToken: string | null
    refreshToken: string | null
    expiresAt: number | null
  } | null
  
  // Loading states
  isLoading: boolean
  isInitialized: boolean
  
  // Computed properties
  isAuthenticated: boolean
  role: UserRole | null
  tenantId: string | null
  subdomain: string | null
  
  // Actions
  setAuth: (authUser: AuthUser, dbUser: DbUser, tenant: Tenant, session: any) => void
  updateSession: (session: any) => void
  updateUser: (dbUser: Partial<DbUser>) => void
  updateTenant: (tenant: Partial<Tenant>) => void
  clearAuth: () => void
  setLoading: (isLoading: boolean) => void
  initialize: () => Promise<void>
  
  // Helper methods
  hasPermission: (permission: string) => boolean
  hasRole: (requiredRole: UserRole) => boolean
}

// Import RBAC utilities
import { can, hasRole as checkRole } from '@/lib/auth/rbac'

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      authUser: null,
      dbUser: null,
      tenant: null,
      session: null,
      isLoading: false,
      isInitialized: false,
      isAuthenticated: false,
      role: null,
      tenantId: null,
      subdomain: null,
      
      // Set complete auth state
      setAuth: (authUser, dbUser, tenant, session) => {
        set({
          authUser,
          dbUser,
          tenant,
          session: session ? {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt: session.expires_at
          } : null,
          isAuthenticated: true,
          role: dbUser.role as UserRole,
          tenantId: tenant.id,
          subdomain: tenant.subdomain,
          isLoading: false,
          isInitialized: true
        })
      },
      
      // Update session
      updateSession: (session) => {
        set({
          session: session ? {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt: session.expires_at
          } : null
        })
      },
      
      // Update user details
      updateUser: (updates) => {
        const currentUser = get().dbUser
        if (currentUser) {
          set({
            dbUser: { ...currentUser, ...updates },
            role: updates.role ? updates.role as UserRole : currentUser.role as UserRole
          })
        }
      },
      
      // Update tenant details
      updateTenant: (updates) => {
        const currentTenant = get().tenant
        if (currentTenant) {
          set({
            tenant: { ...currentTenant, ...updates }
          })
        }
      },
      
      // Clear auth state
      clearAuth: () => {
        set({
          authUser: null,
          dbUser: null,
          tenant: null,
          session: null,
          isAuthenticated: false,
          role: null,
          tenantId: null,
          subdomain: null,
          isLoading: false
        })
      },
      
      // Set loading state
      setLoading: (isLoading) => {
        set({ isLoading })
      },
      
      // Initialize auth state from storage
      initialize: async () => {
        const state = get()
        
        // Check if session is expired
        if (state.session?.expiresAt) {
          const now = Math.floor(Date.now() / 1000)
          if (state.session.expiresAt < now) {
            // Session expired, clear auth
            state.clearAuth()
          }
        }
        
        set({ isInitialized: true })
      },
      
      // Check permission
      hasPermission: (permission) => {
        const role = get().role
        return can(role, permission as any)
      },
      
      // Check role
      hasRole: (requiredRole) => {
        const role = get().role
        return checkRole(role, requiredRole)
      }
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        authUser: state.authUser,
        dbUser: state.dbUser,
        tenant: state.tenant,
        session: state.session,
        isAuthenticated: state.isAuthenticated,
        role: state.role,
        tenantId: state.tenantId,
        subdomain: state.subdomain
      }),
      onRehydrateStorage: () => (state) => {
        // After rehydration, check session validity
        if (state) {
          state.initialize()
        }
      }
    }
  )
)

// Helper hook for auth status
export function useAuth() {
  const {
    isAuthenticated,
    isLoading,
    isInitialized,
    dbUser,
    tenant,
    role,
    hasPermission,
    hasRole
  } = useAuthStore()
  
  return {
    isAuthenticated,
    isLoading,
    isInitialized,
    user: dbUser,
    tenant,
    role,
    hasPermission,
    hasRole
  }
}

// Helper hook for auth actions
export function useAuthActions() {
  const {
    setAuth,
    updateSession,
    updateUser,
    updateTenant,
    clearAuth,
    setLoading
  } = useAuthStore()
  
  return {
    setAuth,
    updateSession,
    updateUser,
    updateTenant,
    clearAuth,
    setLoading
  }
}