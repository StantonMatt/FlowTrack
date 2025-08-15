import { db } from '@/lib/db/offline';

export interface SyncTelemetry {
  timestamp: Date;
  duration: number;
  totalItems: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  photoUploads: number;
  photoUploadFailures: number;
  averageRetries: number;
  networkType?: string;
  connectionSpeed?: number;
  errors: Array<{
    type: string;
    message: string;
    count: number;
  }>;
}

export interface SyncMetrics {
  lastSync?: Date;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageDuration: number;
  averageItemsPerSync: number;
  totalDataSynced: number;
  totalPhotosSynced: number;
}

/**
 * Telemetry service for tracking sync operations
 */
export class TelemetryService {
  private currentSession: {
    startTime: number;
    items: Map<string, {
      attempts: number;
      success: boolean;
      error?: string;
      hasPhoto: boolean;
      photoUploaded: boolean;
    }>;
    errors: Map<string, number>;
  } | null = null;

  /**
   * Start a new telemetry session
   */
  startSession(): void {
    this.currentSession = {
      startTime: Date.now(),
      items: new Map(),
      errors: new Map(),
    };
  }

  /**
   * Track a sync attempt
   */
  trackAttempt(
    itemId: string,
    options: {
      hasPhoto?: boolean;
      isRetry?: boolean;
    } = {}
  ): void {
    if (!this.currentSession) return;

    const existing = this.currentSession.items.get(itemId) || {
      attempts: 0,
      success: false,
      hasPhoto: false,
      photoUploaded: false,
    };

    this.currentSession.items.set(itemId, {
      ...existing,
      attempts: existing.attempts + 1,
      hasPhoto: options.hasPhoto || existing.hasPhoto,
    });
  }

  /**
   * Track a successful sync
   */
  trackSuccess(
    itemId: string,
    options: {
      photoUploaded?: boolean;
    } = {}
  ): void {
    if (!this.currentSession) return;

    const existing = this.currentSession.items.get(itemId);
    if (existing) {
      existing.success = true;
      existing.photoUploaded = options.photoUploaded || false;
    }
  }

  /**
   * Track a sync failure
   */
  trackFailure(
    itemId: string,
    error: Error | string
  ): void {
    if (!this.currentSession) return;

    const errorMessage = error instanceof Error ? error.message : error;
    const existing = this.currentSession.items.get(itemId);
    if (existing) {
      existing.success = false;
      existing.error = errorMessage;
    }

    // Track error types
    const errorType = this.categorizeError(errorMessage);
    this.currentSession.errors.set(
      errorType,
      (this.currentSession.errors.get(errorType) || 0) + 1
    );
  }

  /**
   * End the current session and return telemetry
   */
  endSession(): SyncTelemetry | null {
    if (!this.currentSession) return null;

    const duration = Date.now() - this.currentSession.startTime;
    const items = Array.from(this.currentSession.items.values());
    
    const telemetry: SyncTelemetry = {
      timestamp: new Date(),
      duration,
      totalItems: items.length,
      successCount: items.filter(i => i.success).length,
      failureCount: items.filter(i => !i.success).length,
      retryCount: items.reduce((sum, i) => sum + Math.max(0, i.attempts - 1), 0),
      photoUploads: items.filter(i => i.photoUploaded).length,
      photoUploadFailures: items.filter(i => i.hasPhoto && !i.photoUploaded).length,
      averageRetries: items.length > 0 
        ? items.reduce((sum, i) => sum + i.attempts, 0) / items.length 
        : 0,
      networkType: this.getNetworkType(),
      connectionSpeed: this.getConnectionSpeed(),
      errors: Array.from(this.currentSession.errors.entries()).map(([type, count]) => ({
        type,
        message: type,
        count,
      })),
    };

    // Store telemetry
    this.storeTelemetry(telemetry);

    // Send to server if online
    if (navigator.onLine) {
      this.sendTelemetry(telemetry).catch(console.error);
    }

    this.currentSession = null;
    return telemetry;
  }

  /**
   * Store telemetry locally
   */
  private async storeTelemetry(telemetry: SyncTelemetry): Promise<void> {
    try {
      const key = `sync_telemetry_${Date.now()}`;
      const stored = localStorage.getItem('sync_telemetry_history');
      const history = stored ? JSON.parse(stored) : [];
      
      // Keep only last 100 entries
      if (history.length >= 100) {
        history.shift();
      }
      
      history.push({
        key,
        ...telemetry,
      });
      
      localStorage.setItem('sync_telemetry_history', JSON.stringify(history));
    } catch (error) {
      console.error('Failed to store telemetry:', error);
    }
  }

  /**
   * Send telemetry to server
   */
  private async sendTelemetry(telemetry: SyncTelemetry): Promise<void> {
    try {
      await fetch('/api/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'sync_telemetry',
          data: telemetry,
        }),
      });
    } catch (error) {
      console.error('Failed to send telemetry:', error);
    }
  }

  /**
   * Get aggregated metrics
   */
  async getMetrics(): Promise<SyncMetrics> {
    try {
      const stored = localStorage.getItem('sync_telemetry_history');
      const history: SyncTelemetry[] = stored ? JSON.parse(stored) : [];
      
      if (history.length === 0) {
        return {
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          averageDuration: 0,
          averageItemsPerSync: 0,
          totalDataSynced: 0,
          totalPhotosSynced: 0,
        };
      }

      const successfulSyncs = history.filter(h => h.failureCount === 0);
      const totalDuration = history.reduce((sum, h) => sum + h.duration, 0);
      const totalItems = history.reduce((sum, h) => sum + h.successCount, 0);
      const totalPhotos = history.reduce((sum, h) => sum + h.photoUploads, 0);

      return {
        lastSync: history[history.length - 1]?.timestamp,
        totalSyncs: history.length,
        successfulSyncs: successfulSyncs.length,
        failedSyncs: history.length - successfulSyncs.length,
        averageDuration: totalDuration / history.length,
        averageItemsPerSync: totalItems / history.length,
        totalDataSynced: totalItems,
        totalPhotosSynced: totalPhotos,
      };
    } catch (error) {
      console.error('Failed to get metrics:', error);
      return {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        averageDuration: 0,
        averageItemsPerSync: 0,
        totalDataSynced: 0,
        totalPhotosSynced: 0,
      };
    }
  }

  /**
   * Clear telemetry history
   */
  clearHistory(): void {
    localStorage.removeItem('sync_telemetry_history');
  }

  /**
   * Categorize error types
   */
  private categorizeError(error: string): string {
    if (error.includes('401') || error.includes('auth')) {
      return 'Authentication Error';
    }
    if (error.includes('network') || error.includes('fetch')) {
      return 'Network Error';
    }
    if (error.includes('timeout')) {
      return 'Timeout Error';
    }
    if (error.includes('storage') || error.includes('photo')) {
      return 'Storage Error';
    }
    if (error.includes('409') || error.includes('conflict')) {
      return 'Conflict Error';
    }
    if (error.includes('500') || error.includes('server')) {
      return 'Server Error';
    }
    return 'Unknown Error';
  }

  /**
   * Get network type
   */
  private getNetworkType(): string | undefined {
    const connection = (navigator as any).connection || 
                      (navigator as any).mozConnection || 
                      (navigator as any).webkitConnection;
    
    if (connection) {
      return connection.effectiveType || connection.type;
    }
    
    return undefined;
  }

  /**
   * Get connection speed
   */
  private getConnectionSpeed(): number | undefined {
    const connection = (navigator as any).connection || 
                      (navigator as any).mozConnection || 
                      (navigator as any).webkitConnection;
    
    if (connection && connection.downlink) {
      return connection.downlink;
    }
    
    return undefined;
  }

  /**
   * Log sync event
   */
  logEvent(
    event: string,
    data?: Record<string, any>
  ): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
    };

    // Console log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[Sync Telemetry]', event, data);
    }

    // Store in session storage for debugging
    try {
      const logs = sessionStorage.getItem('sync_logs');
      const parsed = logs ? JSON.parse(logs) : [];
      parsed.push(logEntry);
      
      // Keep only last 100 logs
      if (parsed.length > 100) {
        parsed.shift();
      }
      
      sessionStorage.setItem('sync_logs', JSON.stringify(parsed));
    } catch (error) {
      // Ignore storage errors
    }
  }

  /**
   * Get recent sync logs
   */
  getLogs(): Array<{ timestamp: string; event: string; data?: any }> {
    try {
      const logs = sessionStorage.getItem('sync_logs');
      return logs ? JSON.parse(logs) : [];
    } catch {
      return [];
    }
  }
}

// Export singleton instance
export const telemetryService = new TelemetryService();