'use client'

import { useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore, useAuthActions } from '@/stores/auth-store'

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { setAuth, clearAuth, setLoading } = useAuthActions()
  const isInitialized = useAuthStore(state => state.isInitialized)

  const loadAuthState = useCallback(async () => {
    if (isInitialized) return

    setLoading(true)
    const supabase = createClient()

    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession()

      if (session?.user) {
        // Get user details with tenant
        const { data: dbUser } = await supabase
          .from('users')
          .select(`
            *,
            tenant:tenants(*)
          `)
          .eq('auth_user_id', session.user.id)
          .single()

        if (dbUser && dbUser.tenant) {
          setAuth(
            session.user,
            {
              ...dbUser,
              tenant: undefined
            },
            dbUser.tenant,
            session
          )
        } else {
          clearAuth()
        }
      } else {
        clearAuth()
      }
    } catch (error) {
      console.error('Error loading auth state:', error)
      clearAuth()
    } finally {
      setLoading(false)
    }
  }, [isInitialized, setAuth, clearAuth, setLoading])

  useEffect(() => {
    loadAuthState()

    const supabase = createClient()

    // Listen for auth state changes
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // Get user details with tenant
        const { data: dbUser } = await supabase
          .from('users')
          .select(`
            *,
            tenant:tenants(*)
          `)
          .eq('auth_user_id', session.user.id)
          .single()

        if (dbUser && dbUser.tenant) {
          setAuth(
            session.user,
            {
              ...dbUser,
              tenant: undefined
            },
            dbUser.tenant,
            session
          )
        }
      } else if (event === 'SIGNED_OUT') {
        clearAuth()
        router.push('/login')
      } else if (event === 'TOKEN_REFRESHED' && session) {
        // Update session in store
        useAuthStore.getState().updateSession(session)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [loadAuthState, setAuth, clearAuth, router])

  // Handle session refresh
  useEffect(() => {
    const refreshSession = async () => {
      const session = useAuthStore.getState().session
      if (!session?.expiresAt) return

      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = session.expiresAt - now

      // Refresh if less than 5 minutes until expiry
      if (timeUntilExpiry < 300 && timeUntilExpiry > 0) {
        try {
          const response = await fetch('/api/auth/refresh', {
            method: 'POST'
          })

          if (response.ok) {
            const data = await response.json()
            if (data.success && data.data) {
              useAuthStore.getState().updateSession(data.data.session)
            }
          }
        } catch (error) {
          console.error('Failed to refresh session:', error)
        }
      }
    }

    // Check every minute
    const interval = setInterval(refreshSession, 60000)
    
    // Initial check
    refreshSession()

    return () => clearInterval(interval)
  }, [])

  // Listen for storage events to sync auth across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth-storage') {
        // Auth state changed in another tab
        if (!e.newValue) {
          // Logged out in another tab
          clearAuth()
          router.push('/login')
        } else {
          // Updated in another tab, reload state
          loadAuthState()
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [clearAuth, loadAuthState, router])

  return <>{children}</>
}