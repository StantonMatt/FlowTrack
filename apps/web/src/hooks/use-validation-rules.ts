import { useState, useEffect, useCallback } from 'react';
import { anomalyService } from '@/lib/readings/anomaly-service';
import { useAuth } from '@/hooks/use-auth';
import type { ValidationRules } from '@shared/schemas/reading';
import type { Database } from '@shared/types/database.types';

type DbValidationRules = Database['public']['Tables']['validation_rules']['Row'];

interface UseValidationRulesReturn {
  rules: DbValidationRules | null;
  isLoading: boolean;
  error: string | null;
  updateRules: (rules: Partial<ValidationRules>) => Promise<void>;
  refreshRules: () => Promise<void>;
  clearCache: () => void;
}

export function useValidationRules(): UseValidationRulesReturn {
  const { session } = useAuth();
  const [rules, setRules] = useState<DbValidationRules | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenantId = session?.user?.user_metadata?.tenant_id;

  const loadRules = useCallback(async () => {
    if (!tenantId) {
      setError('No tenant ID available');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const currentRules = await anomalyService.getValidationRules(tenantId);
      setRules(currentRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load validation rules');
      console.error('Error loading validation rules:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const updateRules = useCallback(async (newRules: Partial<ValidationRules>) => {
    if (!tenantId) {
      throw new Error('No tenant ID available');
    }

    setError(null);

    try {
      const updatedRules = await anomalyService.upsertValidationRules(tenantId, newRules);
      setRules(updatedRules);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update validation rules';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [tenantId]);

  const refreshRules = useCallback(async () => {
    await loadRules();
  }, [loadRules]);

  const clearCache = useCallback(() => {
    anomalyService.clearCache();
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  return {
    rules,
    isLoading,
    error,
    updateRules,
    refreshRules,
    clearCache,
  };
}

interface UseAnomalyReviewReturn {
  reviewAnomaly: (
    readingId: string,
    action: 'approve' | 'clear' | 'investigate',
    notes?: string
  ) => Promise<void>;
  isReviewing: boolean;
  reviewError: string | null;
}

export function useAnomalyReview(): UseAnomalyReviewReturn {
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const reviewAnomaly = useCallback(async (
    readingId: string,
    action: 'approve' | 'clear' | 'investigate',
    notes?: string
  ) => {
    setIsReviewing(true);
    setReviewError(null);

    try {
      await anomalyService.reviewAnomaly(readingId, action, notes);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to review anomaly';
      setReviewError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsReviewing(false);
    }
  }, []);

  return {
    reviewAnomaly,
    isReviewing,
    reviewError,
  };
}

interface AnomalyStats {
  statistics: any | null;
  isLoading: boolean;
  error: string | null;
  refreshStats: () => Promise<void>;
}

export function useAnomalyStatistics(
  dateRange?: { from: Date; to: Date }
): AnomalyStats {
  const { session } = useAuth();
  const [statistics, setStatistics] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenantId = session?.user?.user_metadata?.tenant_id;

  const loadStatistics = useCallback(async () => {
    if (!tenantId) {
      setError('No tenant ID available');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const stats = await anomalyService.getAnomalyStatistics(
        tenantId,
        dateRange?.from,
        dateRange?.to
      );
      setStatistics(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load anomaly statistics');
      console.error('Error loading anomaly statistics:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, dateRange?.from, dateRange?.to]);

  useEffect(() => {
    loadStatistics();
  }, [loadStatistics]);

  return {
    statistics,
    isLoading,
    error,
    refreshStats: loadStatistics,
  };
}

interface SuggestedActions {
  actions: string[];
  getActions: (flag: 'negative' | 'low' | 'high', consumption: number) => string[];
}

export function useAnomalySuggestions(): SuggestedActions {
  const getActions = useCallback((
    flag: 'negative' | 'low' | 'high',
    consumption: number
  ): string[] => {
    return anomalyService.getSuggestedActions(flag, consumption);
  }, []);

  return {
    actions: [],
    getActions,
  };
}