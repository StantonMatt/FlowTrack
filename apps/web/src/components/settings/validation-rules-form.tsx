'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon, Info, AlertTriangle, TrendingUp, TrendingDown, Save } from 'lucide-react';
import type { ValidationRules } from '@shared/schemas/reading';

const validationRulesSchema = z.object({
  lowThreshold: z.coerce
    .number()
    .min(0, 'Low threshold must be non-negative')
    .max(1000000, 'Low threshold too large'),
  highThreshold: z.coerce
    .number()
    .min(1, 'High threshold must be positive')
    .max(1000000, 'High threshold too large'),
  minDeltaPct: z.coerce
    .number()
    .min(-100, 'Minimum change cannot be less than -100%')
    .max(0, 'Minimum change must be negative or zero'),
  maxDeltaPct: z.coerce
    .number()
    .min(0, 'Maximum change must be positive or zero')
    .max(1000, 'Maximum change cannot exceed 1000%'),
  effectiveFrom: z.date(),
  hasEndDate: z.boolean(),
  effectiveTo: z.date().nullable().optional(),
}).refine(
  (data) => data.highThreshold > data.lowThreshold,
  {
    message: 'High threshold must be greater than low threshold',
    path: ['highThreshold'],
  }
);

type FormData = z.infer<typeof validationRulesSchema>;

interface ValidationRulesFormProps {
  currentRules?: ValidationRules | null;
  onSubmit: (rules: Partial<ValidationRules>) => Promise<void>;
  isLoading?: boolean;
}

export function ValidationRulesForm({ 
  currentRules, 
  onSubmit, 
  isLoading = false 
}: ValidationRulesFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(validationRulesSchema),
    defaultValues: {
      lowThreshold: currentRules?.lowThreshold ?? 0,
      highThreshold: currentRules?.highThreshold ?? 10000,
      minDeltaPct: currentRules?.minDeltaPct ?? -50,
      maxDeltaPct: currentRules?.maxDeltaPct ?? 200,
      effectiveFrom: currentRules?.effectiveFrom 
        ? new Date(currentRules.effectiveFrom)
        : new Date(),
      hasEndDate: !!currentRules?.effectiveTo,
      effectiveTo: currentRules?.effectiveTo 
        ? new Date(currentRules.effectiveTo)
        : null,
    },
  });

  const hasEndDate = form.watch('hasEndDate');

  const handleSubmit = async (data: FormData) => {
    setError(null);
    setSuccess(false);

    try {
      const rules: Partial<ValidationRules> = {
        lowThreshold: data.lowThreshold,
        highThreshold: data.highThreshold,
        minDeltaPct: data.minDeltaPct,
        maxDeltaPct: data.maxDeltaPct,
        effectiveFrom: data.effectiveFrom.toISOString(),
        effectiveTo: data.hasEndDate && data.effectiveTo 
          ? data.effectiveTo.toISOString()
          : null,
      };

      await onSubmit(rules);
      setSuccess(true);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save validation rules');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anomaly Detection Rules</CardTitle>
        <CardDescription>
          Configure thresholds and rules for automatic anomaly detection in meter readings
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            {/* Absolute Thresholds */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Absolute Thresholds</h3>
                <Badge variant="secondary">Consumption Values</Badge>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="lowThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Low Threshold</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <TrendingDown className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            {...field}
                            type="number"
                            step="0.001"
                            placeholder="0"
                            className="pl-9"
                            disabled={isLoading}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Consumption below this value will be flagged as low
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="highThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>High Threshold</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <TrendingUp className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            {...field}
                            type="number"
                            step="0.001"
                            placeholder="10000"
                            className="pl-9"
                            disabled={isLoading}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Consumption above this value will be flagged as high
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Percentage Change Thresholds */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Change Thresholds</h3>
                <Badge variant="secondary">Period-over-Period</Badge>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="minDeltaPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Change %</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            %
                          </span>
                          <Input
                            {...field}
                            type="number"
                            step="1"
                            placeholder="-50"
                            className="pl-8"
                            disabled={isLoading}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Decreases beyond this percentage will be flagged
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxDeltaPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Change %</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            %
                          </span>
                          <Input
                            {...field}
                            type="number"
                            step="1"
                            placeholder="200"
                            className="pl-8"
                            disabled={isLoading}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Increases beyond this percentage will be flagged
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Effective Dates */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Effective Period</h3>
                <Badge variant="secondary">Schedule</Badge>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="effectiveFrom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effective From</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                'w-full justify-start text-left font-normal',
                                !field.value && 'text-muted-foreground'
                              )}
                              disabled={isLoading}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? (
                                format(field.value, 'PPP')
                              ) : (
                                <span>Pick a date</span>
                              )}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormDescription>
                        When these rules become active
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="hasEndDate"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Set End Date</FormLabel>
                          <FormDescription className="text-xs">
                            Rules expire on specified date
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isLoading}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {hasEndDate && (
                    <FormField
                      control={form.control}
                      name="effectiveTo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Effective Until</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    'w-full justify-start text-left font-normal',
                                    !field.value && 'text-muted-foreground'
                                  )}
                                  disabled={isLoading}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {field.value ? (
                                    format(field.value, 'PPP')
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value || undefined}
                                onSelect={field.onChange}
                                initialFocus
                                disabled={(date) =>
                                  date < form.getValues('effectiveFrom')
                                }
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                These rules will be applied automatically to all new meter readings.
                Existing readings will not be re-evaluated unless explicitly requested.
              </AlertDescription>
            </Alert>

            {/* Error/Success Messages */}
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="bg-green-50 text-green-900 border-green-200">
                <Save className="h-4 w-4" />
                <AlertDescription>
                  Validation rules saved successfully
                </AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <div className="flex justify-end">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Saving...' : 'Save Rules'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}