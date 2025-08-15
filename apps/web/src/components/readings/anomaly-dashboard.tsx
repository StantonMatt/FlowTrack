'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  AlertTriangle, 
  TrendingDown, 
  TrendingUp, 
  Activity,
  CheckCircle,
  XCircle,
  RefreshCw,
  FileText,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { anomalyService } from '@/lib/readings/anomaly-service';
import type { AnomalyStatistics } from '@/lib/readings/anomaly-service';
import type { Database } from '@shared/types/database.types';

type DbReading = Database['public']['Tables']['meter_readings']['Row'];

interface AnomalyDashboardProps {
  tenantId: string;
  dateRange?: {
    from: Date;
    to: Date;
  };
  onReadingClick?: (reading: DbReading) => void;
}

export function AnomalyDashboard({ 
  tenantId, 
  dateRange,
  onReadingClick 
}: AnomalyDashboardProps) {
  const [statistics, setStatistics] = useState<AnomalyStatistics | null>(null);
  const [anomalousReadings, setAnomalousReadings] = useState<DbReading[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState('overview');

  useEffect(() => {
    loadData();
  }, [tenantId, dateRange]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [stats, readings] = await Promise.all([
        anomalyService.getAnomalyStatistics(
          tenantId,
          dateRange?.from,
          dateRange?.to
        ),
        anomalyService.getAnomalousReadings(tenantId, 50)
      ]);

      setStatistics(stats);
      setAnomalousReadings(readings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load anomaly data');
    } finally {
      setIsLoading(false);
    }
  };

  const getAnomalyIcon = (flag: string) => {
    switch (flag) {
      case 'negative':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'low':
        return <TrendingDown className="h-4 w-4 text-yellow-600" />;
      case 'high':
        return <TrendingUp className="h-4 w-4 text-orange-600" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getAnomalyColor = (flag: string) => {
    switch (flag) {
      case 'negative':
        return 'destructive';
      case 'low':
        return 'warning';
      case 'high':
        return 'orange';
      default:
        return 'secondary';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!statistics) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Readings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.totalReadings}</div>
            <p className="text-xs text-muted-foreground mt-1">
              In selected period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Anomalies Detected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {statistics.totalAnomalies}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs">
                {statistics.anomalyRate.toFixed(1)}%
              </Badge>
              <span className="text-xs text-muted-foreground">detection rate</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Most Common</CardTitle>
          </CardHeader>
          <CardContent>
            {statistics.byType.high >= statistics.byType.low && 
             statistics.byType.high >= statistics.byType.negative ? (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-orange-600" />
                <div>
                  <div className="font-semibold">High Usage</div>
                  <div className="text-xs text-muted-foreground">
                    {statistics.byType.high} cases
                  </div>
                </div>
              </div>
            ) : statistics.byType.low >= statistics.byType.negative ? (
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-yellow-600" />
                <div>
                  <div className="font-semibold">Low Usage</div>
                  <div className="text-xs text-muted-foreground">
                    {statistics.byType.low} cases
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <div>
                  <div className="font-semibold">Negative</div>
                  <div className="text-xs text-muted-foreground">
                    {statistics.byType.negative} cases
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Action Required</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {statistics.byType.negative}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Negative consumption cases
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed View */}
      <Card>
        <CardHeader>
          <CardTitle>Anomaly Analysis</CardTitle>
          <CardDescription>
            Detailed breakdown of detected anomalies and patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="reasons">Common Reasons</TabsTrigger>
              <TabsTrigger value="readings">Recent Anomalies</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Anomaly Type Distribution */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Distribution by Type</h4>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-orange-600" />
                      <span className="text-sm font-medium">High Consumption</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {statistics.byType.high} readings
                      </span>
                      <Progress 
                        value={(statistics.byType.high / statistics.totalAnomalies) * 100}
                        className="w-24 h-2"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-yellow-600" />
                      <span className="text-sm font-medium">Low Consumption</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {statistics.byType.low} readings
                      </span>
                      <Progress 
                        value={(statistics.byType.low / statistics.totalAnomalies) * 100}
                        className="w-24 h-2"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm font-medium">Negative Consumption</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {statistics.byType.negative} readings
                      </span>
                      <Progress 
                        value={(statistics.byType.negative / statistics.totalAnomalies) * 100}
                        className="w-24 h-2"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="text-sm font-semibold">Recommended Actions</h4>
                <div className="space-y-2">
                  {statistics.byType.negative > 0 && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {statistics.byType.negative} negative consumption readings require immediate review.
                        These may indicate meter replacements or data entry errors.
                      </AlertDescription>
                    </Alert>
                  )}
                  {statistics.anomalyRate > 10 && (
                    <Alert>
                      <Activity className="h-4 w-4" />
                      <AlertDescription>
                        High anomaly rate ({statistics.anomalyRate.toFixed(1)}%) detected.
                        Consider reviewing validation thresholds.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="reasons" className="space-y-4">
              {statistics.commonReasons.length > 0 ? (
                <div className="space-y-3">
                  {statistics.commonReasons.map((reason, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{reason.reason}</p>
                          <p className="text-xs text-muted-foreground">
                            {reason.count} occurrences
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">
                        {reason.percentage.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No anomaly reasons recorded
                </div>
              )}
            </TabsContent>

            <TabsContent value="readings" className="space-y-4">
              {anomalousReadings.length > 0 ? (
                <div className="space-y-2">
                  {anomalousReadings.slice(0, 10).map((reading) => (
                    <div 
                      key={reading.id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => onReadingClick?.(reading)}
                    >
                      <div className="flex items-center gap-3">
                        {getAnomalyIcon(reading.anomaly_flag || '')}
                        <div>
                          <p className="text-sm font-medium">
                            Customer {(reading as any).customers?.account_number || reading.customer_id.slice(0, 8)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(reading.reading_date).toLocaleDateString()} • 
                            Consumption: {reading.consumption?.toFixed(0) || 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getAnomalyColor(reading.anomaly_flag || '') as any}>
                          {reading.anomaly_flag}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                  
                  {anomalousReadings.length > 10 && (
                    <Button variant="outline" className="w-full">
                      View All {anomalousReadings.length} Anomalies
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
                  <p className="text-sm font-medium">No Anomalies Detected</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All readings are within normal parameters
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}