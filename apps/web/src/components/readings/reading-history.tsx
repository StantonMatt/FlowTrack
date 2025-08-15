'use client';

import { useState, useEffect, useCallback } from 'react';
import { useReadingsSubscription } from '@/lib/realtime/events';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { 
  CalendarIcon, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Droplets,
  Activity,
  Download,
  RefreshCw,
} from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';

interface Reading {
  id: string;
  customer_id: string;
  reading_value: number;
  reading_date: string;
  consumption: number | null;
  anomaly_flag: boolean;
  anomaly_details?: any;
  metadata?: any;
  created_at: string;
  customers?: {
    id: string;
    account_number: string;
    full_name: string;
    billing_address: any;
  };
}

interface ReadingHistoryProps {
  customerId?: string;
  tenantId: string;
  className?: string;
}

export function ReadingHistory({ customerId, tenantId, className }: ReadingHistoryProps) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [viewType, setViewType] = useState<'consumption' | 'readings' | 'both'>('both');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch readings
  const fetchReadings = useCallback(async () => {
    if (!customerId && !tenantId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        ...(customerId && { customerId }),
        ...(dateRange?.from && { dateFrom: format(dateRange.from, 'yyyy-MM-dd') }),
        ...(dateRange?.to && { dateTo: format(dateRange.to, 'yyyy-MM-dd') }),
        page: page.toString(),
        limit: '50',
        sortBy: 'readingDate',
        sortOrder: 'asc',
      });

      const response = await fetch(`/api/readings?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch readings');
      }

      const data = await response.json();
      setReadings(data.data || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load readings');
      console.error('Error fetching readings:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customerId, tenantId, dateRange, page]);

  useEffect(() => {
    fetchReadings();
  }, [fetchReadings]);

  // Subscribe to realtime updates
  useReadingsSubscription(tenantId, (message) => {
    if (customerId && message.payload.customerId === customerId) {
      // Refresh the data when a new reading is added for this customer
      setRefreshing(true);
      fetchReadings();
    }
  });

  // Prepare chart data
  const chartData = readings.map(reading => ({
    date: format(parseISO(reading.reading_date), 'MMM dd'),
    fullDate: reading.reading_date,
    reading: reading.reading_value,
    consumption: reading.consumption || 0,
    anomaly: reading.anomaly_flag,
  }));

  // Calculate statistics
  const stats = {
    totalConsumption: readings.reduce((sum, r) => sum + (r.consumption || 0), 0),
    avgConsumption: readings.length > 0 
      ? readings.reduce((sum, r) => sum + (r.consumption || 0), 0) / readings.length 
      : 0,
    anomalyCount: readings.filter(r => r.anomaly_flag).length,
    lastReading: readings[readings.length - 1]?.reading_value || 0,
  };

  // Export data
  const handleExport = () => {
    const csv = [
      ['Date', 'Reading', 'Consumption', 'Anomaly'],
      ...readings.map(r => [
        r.reading_date,
        r.reading_value,
        r.consumption || 0,
        r.anomaly_flag ? 'Yes' : 'No',
      ]),
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `readings-${customerId || 'all'}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !refreshing) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full" />
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Reading History</CardTitle>
            <CardDescription>
              {customerId ? 'Customer consumption patterns and trends' : 'All readings overview'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setRefreshing(true);
                fetchReadings();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, 'LLL dd, y')} -{' '}
                      {format(dateRange.to, 'LLL dd, y')}
                    </>
                  ) : (
                    format(dateRange.from, 'LLL dd, y')
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>

          <Select value={viewType} onValueChange={(v: any) => setViewType(v)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consumption">Consumption Only</SelectItem>
              <SelectItem value="readings">Readings Only</SelectItem>
              <SelectItem value="both">Both Charts</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Usage</p>
                  <p className="text-2xl font-bold">{stats.totalConsumption.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">cubic meters</p>
                </div>
                <Droplets className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Daily</p>
                  <p className="text-2xl font-bold">{stats.avgConsumption.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">m³/day</p>
                </div>
                <Activity className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Last Reading</p>
                  <p className="text-2xl font-bold">{stats.lastReading}</p>
                  <p className="text-xs text-muted-foreground">meter units</p>
                </div>
                <TrendingUp className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Anomalies</p>
                  <p className="text-2xl font-bold">{stats.anomalyCount}</p>
                  <p className="text-xs text-muted-foreground">detected</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        {readings.length === 0 ? (
          <Alert>
            <AlertDescription>
              No readings found for the selected date range.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-6">
            {(viewType === 'consumption' || viewType === 'both') && (
              <div>
                <h3 className="text-sm font-medium mb-4">Consumption Trend</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload[0]) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-background border rounded p-2 shadow-lg">
                              <p className="font-medium">{data.fullDate}</p>
                              <p className="text-sm">
                                Consumption: <span className="font-medium">{data.consumption} m³</span>
                              </p>
                              {data.anomaly && (
                                <Badge variant="destructive" className="mt-1">
                                  Anomaly Detected
                                </Badge>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="consumption" 
                      stroke="#3b82f6" 
                      fill="#3b82f6" 
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {(viewType === 'readings' || viewType === 'both') && (
              <div>
                <h3 className="text-sm font-medium mb-4">Meter Readings</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload[0]) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-background border rounded p-2 shadow-lg">
                              <p className="font-medium">{data.fullDate}</p>
                              <p className="text-sm">
                                Reading: <span className="font-medium">{data.reading}</span>
                              </p>
                              {data.anomaly && (
                                <Badge variant="destructive" className="mt-1">
                                  Anomaly Detected
                                </Badge>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="reading" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={{ fill: '#10b981', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}