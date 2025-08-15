'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Users, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/use-debounce'
import { createClient } from '@/lib/supabase/client'
import { Customer } from '@/types/models'

interface SearchModalProps {
  open: boolean
  onClose: () => void
  tenantId: string
}

export function SearchModal({ open, onClose, tenantId }: SearchModalProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  
  const debouncedQuery = useDebounce(query, 300)

  // Search customers
  const searchCustomers = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults([])
      return
    }

    setLoading(true)
    const supabase = createClient()
    
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, account_number, full_name, email, status')
        .eq('tenant_id', tenantId)
        .or(`full_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,account_number.ilike.%${searchQuery}%`)
        .limit(10)

      if (!error && data) {
        setResults(data)
      } else {
        setResults([])
      }
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  // Perform search when debounced query changes
  useEffect(() => {
    searchCustomers(debouncedQuery)
  }, [debouncedQuery, searchCustomers])

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => 
          prev < results.length - 1 ? prev + 1 : prev
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => prev > 0 ? prev - 1 : 0)
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault()
        handleSelect(results[selectedIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, results, selectedIndex])

  // Handle selection
  const handleSelect = (customer: Customer) => {
    router.push(`/admin/customers/${customer.id}`)
    onClose()
    setQuery('')
    setResults([])
    setSelectedIndex(0)
  }

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
    }
  }, [open])

  // Handle global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onClose() // Toggle
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl p-0">
        <DialogHeader className="sr-only">
          <h2>Search customers</h2>
        </DialogHeader>
        
        <div className="flex items-center border-b px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers by name, email, or account number..."
            className="flex-1 border-0 px-3 py-4 focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
          />
          {loading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {results.length > 0 ? (
            <div className="space-y-1">
              {results.map((customer, index) => (
                <button
                  key={customer.id}
                  onClick={() => handleSelect(customer)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    index === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{customer.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {customer.account_number} • {customer.email}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    customer.status === 'active' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                  }`}>
                    {customer.status}
                  </span>
                </button>
              ))}
            </div>
          ) : query && !loading ? (
            <div className="p-8 text-center text-muted-foreground">
              No customers found for "{query}"
            </div>
          ) : !query ? (
            <div className="p-8 text-center text-muted-foreground">
              Start typing to search customers
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}