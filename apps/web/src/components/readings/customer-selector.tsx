'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface Customer {
  id: string;
  account_number: string;
  full_name: string;
  billing_address?: any;
}

interface CustomerSelectorProps {
  tenantId: string;
  value?: string;
  onValueChange?: (value: string | undefined) => void;
  className?: string;
}

export function CustomerSelector({ 
  tenantId, 
  value, 
  onValueChange,
  className 
}: CustomerSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Fetch customers
  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: '100',
          ...(searchQuery && { search: searchQuery }),
        });

        const response = await fetch(`/api/customers?${params}`);
        if (!response.ok) throw new Error('Failed to fetch customers');

        const data = await response.json();
        setCustomers(data.data || []);
      } catch (error) {
        console.error('Error fetching customers:', error);
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  const selectedCustomer = customers.find(c => c.id === value);

  const handleSelect = (customerId: string | undefined) => {
    // Update URL params
    const params = new URLSearchParams(searchParams.toString());
    if (customerId) {
      params.set('customerId', customerId);
    } else {
      params.delete('customerId');
    }
    router.push(`?${params.toString()}`);
    
    // Call callback if provided
    onValueChange?.(customerId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
        >
          {selectedCustomer ? (
            <span className="truncate">
              {selectedCustomer.account_number} - {selectedCustomer.full_name}
            </span>
          ) : (
            <span className="text-muted-foreground">Select customer...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput 
            placeholder="Search customers..." 
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            {loading ? (
              <CommandEmpty>Loading customers...</CommandEmpty>
            ) : customers.length === 0 ? (
              <CommandEmpty>No customers found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {value && (
                  <CommandItem
                    value=""
                    onSelect={() => handleSelect(undefined)}
                  >
                    <Check className={cn("mr-2 h-4 w-4", "opacity-0")} />
                    <span className="text-muted-foreground">All customers</span>
                  </CommandItem>
                )}
                {customers.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => handleSelect(customer.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === customer.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {customer.account_number}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {customer.full_name}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}