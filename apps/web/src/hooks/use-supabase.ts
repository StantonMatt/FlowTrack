'use client';

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Database } from '@/types/database.types'
import { SupabaseClient } from '@supabase/supabase-js'

export function useSupabase() {
  const [supabase] = useState<SupabaseClient<Database>>(() => createClient())
  
  return { supabase }
}