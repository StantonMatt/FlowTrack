import { useEffect, useState } from 'react'
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { useSupabase } from './use-supabase'

interface UseRealtimeOptions {
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  schema?: string
  filter?: string
}

export function useRealtime<T = any>(
  table: string,
  callback: (payload: RealtimePostgresChangesPayload<T>) => void,
  options: UseRealtimeOptions = {}
) {
  const supabase = useSupabase()
  const [channel, setChannel] = useState<RealtimeChannel | null>(null)
  const [isSubscribed, setIsSubscribed] = useState(false)

  useEffect(() => {
    const { event = '*', schema = 'public', filter } = options

    const channelName = `realtime:${schema}:${table}:${event}${filter ? `:${filter}` : ''}`
    const newChannel = supabase.channel(channelName)

    const subscription = newChannel
      .on(
        'postgres_changes',
        {
          event,
          schema,
          table,
          filter,
        },
        (payload) => {
          callback(payload as RealtimePostgresChangesPayload<T>)
        }
      )
      .subscribe((status) => {
        setIsSubscribed(status === 'SUBSCRIBED')
      })

    setChannel(newChannel)

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [table, options.event, options.schema, options.filter])

  const unsubscribe = () => {
    if (channel) {
      supabase.removeChannel(channel)
      setChannel(null)
      setIsSubscribed(false)
    }
  }

  return {
    isSubscribed,
    unsubscribe,
  }
}