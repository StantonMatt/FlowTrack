import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { useSupabase } from './use-supabase'
import { Tenant, User as DbUser } from '@/types/models'

interface AuthState {
  user: User | null
  dbUser: DbUser | null
  tenant: Tenant | null
  isLoading: boolean
  isAuthenticated: boolean
}

export function useAuth() {
  const supabase = useSupabase()
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    dbUser: null,
    tenant: null,
    isLoading: true,
    isAuthenticated: false,
  })

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        
        if (session?.user) {
          // Get user details from database
          const { data: dbUser } = await supabase
            .from('users')
            .select('*')
            .eq('auth_user_id', session.user.id)
            .single()
          
          // Get tenant details
          let tenant = null
          if (dbUser) {
            const { data: tenantData } = await supabase
              .from('tenants')
              .select('*')
              .eq('id', dbUser.tenant_id)
              .single()
            tenant = tenantData
          }
          
          setAuthState({
            user: session.user,
            dbUser,
            tenant,
            isLoading: false,
            isAuthenticated: true,
          })
        } else {
          setAuthState({
            user: null,
            dbUser: null,
            tenant: null,
            isLoading: false,
            isAuthenticated: false,
          })
        }
      } catch (error) {
        console.error('Error getting session:', error)
        setAuthState({
          user: null,
          dbUser: null,
          tenant: null,
          isLoading: false,
          isAuthenticated: false,
        })
      }
    }

    getSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // Get user details from database
        const { data: dbUser } = await supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .single()
        
        // Get tenant details
        let tenant = null
        if (dbUser) {
          const { data: tenantData } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', dbUser.tenant_id)
            .single()
          tenant = tenantData
        }
        
        setAuthState({
          user: session.user,
          dbUser,
          tenant,
          isLoading: false,
          isAuthenticated: true,
        })
      } else {
        setAuthState({
          user: null,
          dbUser: null,
          tenant: null,
          isLoading: false,
          isAuthenticated: false,
        })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const signUp = async (email: string, password: string, metadata?: Record<string, any>) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    })
    return { data, error }
  }

  return {
    ...authState,
    signIn,
    signOut,
    signUp,
  }
}