'use client';

import { useState, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  MoreHorizontal, 
  Search, 
  Download, 
  Upload,
  Plus,
  Edit,
  Trash2,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Customer, CustomerStatus, MeterType } from '@flowtrack/shared/schemas/customer';

interface CustomerTableProps {
  onEdit?: (customer: Customer) => void;
  onView?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
  onImport?: () => void;
  onCreate?: () => void;
}

export function CustomerTable({
  onEdit,
  onView,
  onDelete,
  onImport,
  onCreate,
}: CustomerTableProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  });
  
  const { toast } = useToast();

  // Define columns
  const columns: ColumnDef<Customer>[] = [
    {
      accessorKey: 'account_number',
      header: 'Account #',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.getValue('account_number')}</span>
      ),
    },
    {
      accessorKey: 'full_name',
      header: 'Full Name',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.getValue('full_name')}</div>
          {row.original.email && (
            <div className="text-sm text-muted-foreground">{row.original.email}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'meter_id',
      header: 'Meter ID',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.getValue('meter_id')}</span>
      ),
    },
    {
      accessorKey: 'meter_type',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('meter_type') as MeterType;
        const colors = {
          water: 'bg-blue-100 text-blue-800',
          electric: 'bg-yellow-100 text-yellow-800',
          gas: 'bg-orange-100 text-orange-800',
          other: 'bg-gray-100 text-gray-800',
        };
        return (
          <Badge className={colors[type] || colors.other}>
            {type}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as CustomerStatus;
        const colors = {
          active: 'bg-green-100 text-green-800',
          inactive: 'bg-gray-100 text-gray-800',
          suspended: 'bg-red-100 text-red-800',
        };
        return (
          <Badge className={colors[status] || colors.inactive}>
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'service_address',
      header: 'Service Address',
      cell: ({ row }) => {
        const address = row.original.service_address;
        if (!address) return '-';
        return (
          <div className="text-sm">
            <div>{address.street}</div>
            <div className="text-muted-foreground">
              {address.city}, {address.state} {address.zip}
            </div>
          </div>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const customer = row.original;
        
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onView?.(customer)}>
                <Eye className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit?.(customer)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => onDelete?.(customer)}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  // Create table instance
  const table = useReactTable({
    data: customers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination,
    },
    manualPagination: true,
    pageCount: Math.ceil(totalCount / pagination.pageSize),
  });

  // Fetch customers
  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.pageIndex + 1),
        limit: String(pagination.pageSize),
        ...(globalFilter && { q: globalFilter }),
        ...(sorting.length > 0 && {
          sort_by: sorting[0].id,
          sort_order: sorting[0].desc ? 'desc' : 'asc',
        }),
      });

      // Add column filters
      columnFilters.forEach((filter) => {
        params.append(filter.id, String(filter.value));
      });

      const response = await fetch(`/api/customers?${params}`);
      const result = await response.json();
      
      if (result.success) {
        setCustomers(result.data.data);
        setTotalCount(result.data.pagination.total);
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch customers',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Export customers
  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        ...(globalFilter && { q: globalFilter }),
        ...(sorting.length > 0 && {
          sort_by: sorting[0].id,
          sort_order: sorting[0].desc ? 'desc' : 'asc',
        }),
      });

      // Add column filters
      columnFilters.forEach((filter) => {
        params.append(filter.id, String(filter.value));
      });

      const response = await fetch(`/api/customers/export?${params}`);
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        toast({
          title: 'Success',
          description: 'Customers exported successfully',
        });
      } else {
        throw new Error('Export failed');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to export customers',
        variant: 'destructive',
      });
    }
  };

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchCustomers();
  }, [pagination, sorting, columnFilters, globalFilter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Customers</h2>
        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={onImport} variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button onClick={onCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={columnFilters.find(f => f.id === 'status')?.value as string || 'all'}
          onValueChange={(value) => {
            if (value === 'all') {
              setColumnFilters(filters => filters.filter(f => f.id !== 'status'));
            } else {
              setColumnFilters(filters => [
                ...filters.filter(f => f.id !== 'status'),
                { id: 'status', value },
              ]);
            }
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={columnFilters.find(f => f.id === 'meter_type')?.value as string || 'all'}
          onValueChange={(value) => {
            if (value === 'all') {
              setColumnFilters(filters => filters.filter(f => f.id !== 'meter_type'));
            } else {
              setColumnFilters(filters => [
                ...filters.filter(f => f.id !== 'meter_type'),
                { id: 'meter_type', value },
              ]);
            }
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Meter Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="water">Water</SelectItem>
            <SelectItem value="electric">Electric</SelectItem>
            <SelectItem value="gas">Gas</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Button 
          onClick={fetchCustomers} 
          variant="outline" 
          size="icon"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No customers found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {pagination.pageIndex * pagination.pageSize + 1} to{' '}
          {Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalCount)} of{' '}
          {totalCount} customers
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm">
            Page {pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}