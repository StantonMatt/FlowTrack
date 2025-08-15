'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Upload, 
  Clipboard, 
  Trash2, 
  Plus, 
  Save, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  FileSpreadsheet,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface GridRow {
  id: string;
  accountNumber: string;
  customerId?: string;
  customerName?: string;
  reading: number | null;
  readingDate: string;
  previousReading?: number;
  consumption?: number;
  anomalyFlag?: 'high' | 'low' | 'negative' | null;
  status: 'pending' | 'valid' | 'error' | 'submitted';
  error?: string;
}

interface BulkEntryGridProps {
  tenantId: string;
  className?: string;
}

export function BulkEntryGrid({ tenantId, className }: BulkEntryGridProps) {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add new empty row
  const addRow = () => {
    const newRow: GridRow = {
      id: crypto.randomUUID(),
      accountNumber: '',
      reading: null,
      readingDate: format(new Date(), 'yyyy-MM-dd'),
      status: 'pending',
    };
    setRows([...rows, newRow]);
  };

  // Remove selected rows
  const removeRows = () => {
    setRows(rows.filter(row => !selectedRows.has(row.id)));
    setSelectedRows(new Set());
  };

  // Handle paste from clipboard
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const lines = text.trim().split('\n');
      
      const newRows: GridRow[] = lines.map(line => {
        const parts = line.split(/[\t,]/); // Split by tab or comma
        return {
          id: crypto.randomUUID(),
          accountNumber: parts[0]?.trim() || '',
          reading: parts[1] ? parseFloat(parts[1]) : null,
          readingDate: parts[2]?.trim() || format(new Date(), 'yyyy-MM-dd'),
          status: 'pending' as const,
        };
      });

      setRows([...rows, ...newRows]);
      toast.success(`Pasted ${newRows.length} rows`);
      
      // Auto-validate after paste
      setTimeout(() => validateRows([...rows, ...newRows]), 100);
    } catch (error) {
      console.error('Paste error:', error);
      toast.error('Failed to paste from clipboard');
    }
  };

  // Handle CSV file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.trim().split('\n');
      
      // Skip header if present
      const dataLines = lines[0].toLowerCase().includes('account') ? lines.slice(1) : lines;
      
      const newRows: GridRow[] = dataLines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          id: crypto.randomUUID(),
          accountNumber: parts[0] || '',
          reading: parts[1] ? parseFloat(parts[1]) : null,
          readingDate: parts[2] || format(new Date(), 'yyyy-MM-dd'),
          status: 'pending' as const,
        };
      });

      setRows(newRows);
      toast.success(`Loaded ${newRows.length} rows from file`);
      
      // Auto-validate
      setTimeout(() => validateRows(newRows), 100);
    };
    
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  // Validate rows
  const validateRows = async (rowsToValidate?: GridRow[]) => {
    const targetRows = rowsToValidate || rows;
    if (targetRows.length === 0) return;

    setValidating(true);
    
    try {
      // Batch lookup customers
      const accountNumbers = [...new Set(targetRows.map(r => r.accountNumber).filter(Boolean))];
      
      const customerMap = new Map();
      for (const accountNum of accountNumbers) {
        try {
          const response = await fetch(`/api/customers?search=${accountNum}&limit=1`);
          if (response.ok) {
            const data = await response.json();
            if (data.data?.[0]) {
              customerMap.set(accountNum, data.data[0]);
            }
          }
        } catch (error) {
          console.error(`Failed to lookup ${accountNum}:`, error);
        }
      }

      // Validate each row
      const updatedRows = await Promise.all(targetRows.map(async (row) => {
        const customer = customerMap.get(row.accountNumber);
        
        if (!customer) {
          return {
            ...row,
            status: 'error' as const,
            error: 'Customer not found',
          };
        }

        // Get last reading for consumption calculation
        try {
          const response = await fetch(
            `/api/readings?customerId=${customer.id}&limit=1&sortBy=readingDate&sortOrder=desc`
          );
          
          if (response.ok) {
            const data = await response.json();
            const lastReading = data.data?.[0];
            
            const consumption = row.reading && lastReading 
              ? row.reading - lastReading.reading_value 
              : null;

            // Determine anomaly flag
            let anomalyFlag = null;
            if (consumption !== null) {
              if (consumption < 0) anomalyFlag = 'negative';
              else if (consumption > 1000) anomalyFlag = 'high'; // Example threshold
              else if (consumption < 10 && consumption > 0) anomalyFlag = 'low';
            }

            return {
              ...row,
              customerId: customer.id,
              customerName: customer.full_name,
              previousReading: lastReading?.reading_value,
              consumption,
              anomalyFlag,
              status: 'valid' as const,
              error: undefined,
            };
          }
        } catch (error) {
          console.error('Validation error:', error);
        }

        return {
          ...row,
          customerId: customer.id,
          customerName: customer.full_name,
          status: 'valid' as const,
          error: undefined,
        };
      }));

      setRows(updatedRows);
      
      const validCount = updatedRows.filter(r => r.status === 'valid').length;
      const errorCount = updatedRows.filter(r => r.status === 'error').length;
      
      toast.success(`Validated ${validCount} rows${errorCount > 0 ? `, ${errorCount} errors` : ''}`);
    } catch (error) {
      console.error('Validation error:', error);
      toast.error('Failed to validate rows');
    } finally {
      setValidating(false);
    }
  };

  // Submit validated rows
  const submitRows = async () => {
    const validRows = rows.filter(r => r.status === 'valid' && r.customerId);
    
    if (validRows.length === 0) {
      toast.error('No valid rows to submit');
      return;
    }

    setSubmitting(true);
    
    try {
      const payload = {
        items: validRows.map(row => ({
          customerId: row.customerId!,
          reading: row.reading!,
          readingDate: row.readingDate,
          metadata: {
            source: 'bulk',
            method: 'manual' as const,
          },
        })),
      };

      const response = await fetch('/api/readings/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      
      if (response.ok) {
        // Update row statuses based on results
        const updatedRows = rows.map(row => {
          const resultItem = result.results?.find(
            (r: any) => validRows.find(vr => vr.customerId === row.customerId)
          );
          
          if (resultItem?.ok) {
            return { ...row, status: 'submitted' as const };
          }
          return row;
        });
        
        setRows(updatedRows);
        
        toast.success(
          `Submitted ${result.successCount} readings${
            result.failureCount > 0 ? `, ${result.failureCount} failed` : ''
          }`
        );
        
        // Clear submitted rows after a delay
        setTimeout(() => {
          setRows(rows.filter(r => r.status !== 'submitted'));
        }, 2000);
      } else {
        toast.error(result.error || 'Failed to submit readings');
      }
    } catch (error) {
      console.error('Submit error:', error);
      toast.error('Failed to submit readings');
    } finally {
      setSubmitting(false);
    }
  };

  // Update row value
  const updateRow = (id: string, field: keyof GridRow, value: any) => {
    setRows(rows.map(row => 
      row.id === id 
        ? { ...row, [field]: value, status: 'pending' as const }
        : row
    ));
  };

  // Export results
  const exportResults = () => {
    const csv = [
      ['Account', 'Customer', 'Reading', 'Date', 'Consumption', 'Status', 'Error'],
      ...rows.map(r => [
        r.accountNumber,
        r.customerName || '',
        r.reading || '',
        r.readingDate,
        r.consumption || '',
        r.status,
        r.error || '',
      ]),
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk-readings-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validRowCount = rows.filter(r => r.status === 'valid').length;
  const errorRowCount = rows.filter(r => r.status === 'error').length;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Bulk Reading Entry</CardTitle>
            <CardDescription>
              Enter multiple readings using the grid or paste from spreadsheet
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {rows.length} rows
            </Badge>
            {validRowCount > 0 && (
              <Badge variant="default">
                {validRowCount} valid
              </Badge>
            )}
            {errorRowCount > 0 && (
              <Badge variant="destructive">
                {errorRowCount} errors
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Row
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handlePaste}
          >
            <Clipboard className="h-4 w-4 mr-2" />
            Paste
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileUpload}
          />
          
          {selectedRows.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={removeRows}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove ({selectedRows.size})
            </Button>
          )}
          
          <div className="flex-1" />
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => validateRows()}
            disabled={validating || rows.length === 0}
          >
            <Search className="h-4 w-4 mr-2" />
            Validate
          </Button>
          
          <Button
            size="sm"
            onClick={submitRows}
            disabled={submitting || validRowCount === 0}
          >
            <Upload className="h-4 w-4 mr-2" />
            Submit ({validRowCount})
          </Button>
        </div>

        {/* Grid */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === rows.length && rows.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRows(new Set(rows.map(r => r.id)));
                      } else {
                        setSelectedRows(new Set());
                      }
                    }}
                  />
                </TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reading</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Consumption</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No data. Add rows or paste from clipboard to begin.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className={cn(
                    row.status === 'error' && 'bg-destructive/5',
                    row.status === 'submitted' && 'bg-green-50 dark:bg-green-950/20'
                  )}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedRows);
                          if (e.target.checked) {
                            newSet.add(row.id);
                          } else {
                            newSet.delete(row.id);
                          }
                          setSelectedRows(newSet);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.accountNumber}
                        onChange={(e) => updateRow(row.id, 'accountNumber', e.target.value)}
                        placeholder="Account #"
                        className="w-32"
                        disabled={row.status === 'submitted'}
                      />
                    </TableCell>
                    <TableCell>
                      {row.customerName ? (
                        <span className="text-sm">{row.customerName}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={row.reading || ''}
                        onChange={(e) => updateRow(row.id, 'reading', parseFloat(e.target.value))}
                        placeholder="Reading"
                        className="w-28"
                        disabled={row.status === 'submitted'}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={row.readingDate}
                        onChange={(e) => updateRow(row.id, 'readingDate', e.target.value)}
                        className="w-36"
                        disabled={row.status === 'submitted'}
                      />
                    </TableCell>
                    <TableCell>
                      {row.consumption !== undefined && row.consumption !== null ? (
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "font-mono text-sm",
                            row.anomalyFlag === 'negative' && "text-destructive"
                          )}>
                            {row.consumption.toFixed(0)}
                          </span>
                          {row.anomalyFlag && (
                            <Badge variant={
                              row.anomalyFlag === 'negative' ? 'destructive' :
                              row.anomalyFlag === 'high' ? 'warning' : 'secondary'
                            } className="text-xs">
                              {row.anomalyFlag}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.status === 'valid' && (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Valid
                        </Badge>
                      )}
                      {row.status === 'error' && (
                        <div className="space-y-1">
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            Error
                          </Badge>
                          {row.error && (
                            <p className="text-xs text-destructive">{row.error}</p>
                          )}
                        </div>
                      )}
                      {row.status === 'submitted' && (
                        <Badge variant="outline" className="gap-1 bg-green-50 dark:bg-green-950/20">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          Submitted
                        </Badge>
                      )}
                      {row.status === 'pending' && (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Help text */}
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Tips:</strong> Paste data from Excel/Google Sheets directly, or import a CSV file. 
            Format: Account Number, Reading, Date (YYYY-MM-DD). 
            Validate before submitting to check for errors.
          </AlertDescription>
        </Alert>

        {/* Export button */}
        {rows.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={exportResults}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export Results
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}