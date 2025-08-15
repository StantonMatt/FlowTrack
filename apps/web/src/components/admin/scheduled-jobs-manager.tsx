'use client';

import { useState, useEffect } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Calendar, 
  Clock, 
  Play, 
  Pause, 
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ScheduledJob {
  id: string;
  name: string;
  schedule: string;
  description: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  active?: boolean;
}

export function ScheduledJobsManager() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/admin/scheduled-jobs');
      if (!response.ok) throw new Error('Failed to fetch jobs');
      
      const data = await response.json();
      setJobs(data.jobs);
    } catch (error) {
      toast.error('Failed to load scheduled jobs');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleJob = async (jobId: string, enabled: boolean) => {
    setActionInProgress(jobId);
    
    try {
      const response = await fetch('/api/admin/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: enabled ? 'enable' : 'disable',
          jobId,
        }),
      });

      if (!response.ok) throw new Error('Failed to toggle job');
      
      const result = await response.json();
      toast.success(result.message);
      
      await fetchJobs();
    } catch (error) {
      toast.error(`Failed to ${enabled ? 'enable' : 'disable'} job`);
      console.error(error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRunJob = async (jobId: string) => {
    setActionInProgress(jobId);
    
    try {
      const response = await fetch('/api/admin/scheduled-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run',
          jobId,
        }),
      });

      if (!response.ok) throw new Error('Failed to run job');
      
      const result = await response.json();
      toast.success(result.message);
      
      await fetchJobs();
    } catch (error) {
      toast.error('Failed to run job');
      console.error(error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    setActionInProgress(jobId);
    
    try {
      const response = await fetch(`/api/admin/scheduled-jobs?jobId=${jobId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete job');
      
      const result = await response.json();
      toast.success(result.message);
      
      await fetchJobs();
    } catch (error) {
      toast.error('Failed to delete job');
      console.error(error);
    } finally {
      setActionInProgress(null);
      setDeleteConfirm(null);
    }
  };

  const formatSchedule = (schedule: string) => {
    // Parse cron expression
    const parts = schedule.split(' ');
    if (parts.length !== 5) return schedule;
    
    const [minute, hour, day, month, dayOfWeek] = parts;
    
    if (day === '1' && month === '*' && dayOfWeek === '*') {
      return `Monthly on 1st at ${hour}:${minute.padStart(2, '0')}`;
    }
    if (day === '*' && month === '*' && dayOfWeek === '*') {
      return `Daily at ${hour}:${minute.padStart(2, '0')}`;
    }
    if (dayOfWeek !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `Weekly on ${days[parseInt(dayOfWeek)]} at ${hour}:${minute.padStart(2, '0')}`;
    }
    
    return schedule;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Scheduled Jobs</CardTitle>
          <CardDescription>
            Manage automated tasks and background jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{job.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {job.description}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{formatSchedule(job.schedule)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {job.enabled ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Disabled
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.lastRun ? (
                      <span className="text-sm">
                        {format(new Date(job.lastRun), 'MMM d, h:mm a')}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.nextRun ? (
                      <span className="text-sm">
                        {format(new Date(job.nextRun), 'MMM d, h:mm a')}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Switch
                        checked={job.enabled}
                        onCheckedChange={(checked) => handleToggleJob(job.id, checked)}
                        disabled={actionInProgress === job.id}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRunJob(job.id)}
                        disabled={actionInProgress === job.id}
                        title="Run now"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteConfirm(job.id)}
                        disabled={actionInProgress === job.id}
                        title="Delete job"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {jobs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No scheduled jobs configured
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this scheduled job? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDeleteJob(deleteConfirm)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}