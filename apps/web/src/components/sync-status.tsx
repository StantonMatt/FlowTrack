'use client';

import { useState, useEffect } from 'react';
import { useSyncManager } from '@/hooks/use-sync-manager';
import { useConnectivity } from '@/hooks/use-connectivity';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Check,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function SyncStatus() {
  const {
    progress,
    isSyncing,
    triggerSync,
    lastError,
  } = useSyncManager();
  
  const { isOnline } = useConnectivity();
  const [isExpanded, setIsExpanded] = useState(false);

  // Calculate progress percentage
  const progressPercent = progress.total > 0
    ? Math.round(((progress.synced + progress.failed) / progress.total) * 100)
    : 0;

  // Determine status icon and color
  const getStatusIcon = () => {
    if (!isOnline) {
      return <WifiOff className="h-4 w-4" />;
    }
    if (isSyncing) {
      return <RefreshCw className="h-4 w-4 animate-spin" />;
    }
    if (lastError) {
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    }
    if (progress.total === 0 || progress.synced === progress.total) {
      return <Cloud className="h-4 w-4 text-green-600" />;
    }
    return <CloudOff className="h-4 w-4 text-muted-foreground" />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (lastError) return 'Sync failed';
    if (progress.total === 0) return 'All synced';
    if (progress.synced === progress.total) return 'All synced';
    return `${progress.total - progress.synced} pending`;
  };

  const getStatusColor = () => {
    if (!isOnline) return 'text-muted-foreground';
    if (lastError) return 'text-destructive';
    if (isSyncing) return 'text-primary';
    if (progress.total === 0 || progress.synced === progress.total) {
      return 'text-green-600';
    }
    return 'text-yellow-600';
  };

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        {/* Compact Status Indicator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors",
                "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring",
                getStatusColor()
              )}
              aria-label={`Sync status: ${getStatusText()}`}
              aria-expanded={isExpanded}
            >
              {getStatusIcon()}
              <span className="text-sm font-medium">
                {getStatusText()}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1 text-xs">
              <div>Total: {progress.total}</div>
              <div>Synced: {progress.synced}</div>
              {progress.failed > 0 && (
                <div>Failed: {progress.failed}</div>
              )}
              {progress.lastSyncAt && (
                <div>
                  Last sync: {new Date(progress.lastSyncAt).toLocaleTimeString()}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Manual Sync Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => triggerSync()}
              disabled={!isOnline || isSyncing}
              className="h-8 w-8 p-0"
              aria-label="Sync now"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  isSyncing && "animate-spin"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isSyncing ? 'Syncing...' : 'Sync now'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Expanded Progress View */}
      {isExpanded && progress.total > 0 && isSyncing && (
        <div
          className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-background p-4 shadow-lg"
          role="status"
          aria-live="polite"
          aria-label="Sync progress"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Syncing Data</h3>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close sync progress"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>

            <Progress value={progressPercent} className="h-2" />

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progress.synced} of {progress.total}</span>
              <span>{progressPercent}%</span>
            </div>

            {progress.failed > 0 && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                <span>{progress.failed} failed</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Screen Reader Announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {isSyncing && `Syncing ${progress.synced} of ${progress.total} items`}
        {!isSyncing && progress.synced === progress.total && 'All data synced'}
        {lastError && 'Sync failed. Please try again.'}
      </div>
    </div>
  );
}