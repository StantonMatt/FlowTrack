import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'

interface PoolConfig {
  maxConnections?: number
  connectionTimeout?: number
  idleTimeout?: number
  retryAttempts?: number
  retryDelay?: number
}

class SupabasePool {
  private static instance: SupabasePool
  private clients: Map<string, ReturnType<typeof createSupabaseClient<Database>>>
  private config: Required<PoolConfig>
  private lastActivity: Map<string, number>
  private cleanupInterval: NodeJS.Timeout | null = null

  private constructor(config?: PoolConfig) {
    this.clients = new Map()
    this.lastActivity = new Map()
    this.config = {
      maxConnections: config?.maxConnections ?? 5,
      connectionTimeout: config?.connectionTimeout ?? 30000,
      idleTimeout: config?.idleTimeout ?? 60000,
      retryAttempts: config?.retryAttempts ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
    }

    // Start cleanup interval
    this.startCleanup()
  }

  public static getInstance(config?: PoolConfig): SupabasePool {
    if (!SupabasePool.instance) {
      SupabasePool.instance = new SupabasePool(config)
    }
    return SupabasePool.instance
  }

  private startCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      const toRemove: string[] = []

      this.lastActivity.forEach((time, key) => {
        if (now - time > this.config.idleTimeout) {
          toRemove.push(key)
        }
      })

      toRemove.forEach(key => {
        this.clients.delete(key)
        this.lastActivity.delete(key)
      })
    }, 30000) // Run cleanup every 30 seconds
  }

  public getClient(key: string = 'default'): ReturnType<typeof createSupabaseClient<Database>> {
    // Update last activity
    this.lastActivity.set(key, Date.now())

    // Return existing client if available
    if (this.clients.has(key)) {
      return this.clients.get(key)!
    }

    // Check if we've reached max connections
    if (this.clients.size >= this.config.maxConnections) {
      // Find and remove the least recently used client
      let oldestKey = ''
      let oldestTime = Date.now()

      this.lastActivity.forEach((time, k) => {
        if (time < oldestTime && k !== key) {
          oldestTime = time
          oldestKey = k
        }
      })

      if (oldestKey) {
        this.clients.delete(oldestKey)
        this.lastActivity.delete(oldestKey)
      }
    }

    // Create new client
    const client = createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        global: {
          fetch: this.fetchWithRetry.bind(this),
        },
      }
    )

    this.clients.set(key, client)
    return client
  }

  private async fetchWithRetry(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(input, {
          ...init,
          signal: AbortSignal.timeout(this.config.connectionTimeout),
        })

        // Retry on server errors
        if (response.status >= 500 && attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1))
          continue
        }

        return response
      } catch (error) {
        lastError = error as Error

        // Don't retry on client errors
        if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
          if (attempt < this.config.retryAttempts - 1) {
            await this.delay(this.config.retryDelay * (attempt + 1))
            continue
          }
        }

        throw error
      }
    }

    throw lastError || new Error('Failed to fetch after retries')
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  public closeAll() {
    this.clients.clear()
    this.lastActivity.clear()
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  public getStats() {
    return {
      activeConnections: this.clients.size,
      maxConnections: this.config.maxConnections,
      connectionKeys: Array.from(this.clients.keys()),
    }
  }
}

// Export singleton instance
const pool = SupabasePool.getInstance({
  maxConnections: 5,
  connectionTimeout: 30000,
  idleTimeout: 60000,
  retryAttempts: 3,
  retryDelay: 1000,
})

export function getPooledClient(key?: string) {
  return pool.getClient(key)
}

export function getPoolStats() {
  return pool.getStats()
}

export function closeAllConnections() {
  pool.closeAll()
}