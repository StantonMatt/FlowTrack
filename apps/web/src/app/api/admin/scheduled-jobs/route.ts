import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Job configurations
const SCHEDULED_JOBS = {
  'monthly-billing': {
    name: 'Monthly Billing',
    schedule: '0 2 1 * *', // 1st of month at 2 AM
    command: 'SELECT run_monthly_billing();',
    description: 'Generate invoices for all tenants',
  },
  'daily-cleanup': {
    name: 'Daily Cleanup',
    schedule: '0 3 * * *', // Daily at 3 AM
    command: 'SELECT cleanup_old_data();',
    description: 'Clean up expired data and orphaned records',
  },
  'payment-reminders': {
    name: 'Payment Reminders',
    schedule: '0 10 * * *', // Daily at 10 AM
    command: 'SELECT send_payment_reminders();',
    description: 'Send reminder emails for overdue invoices',
  },
  'consumption-stats': {
    name: 'Consumption Statistics',
    schedule: '0 1 * * *', // Daily at 1 AM
    command: 'SELECT update_consumption_statistics();',
    description: 'Update consumption statistics for reporting',
  },
};

export async function GET() {
  try {
    const supabase = await createClient();
    
    // Check authentication and admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleData || roleData.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get scheduled jobs from cron.job table
    const { data: cronJobs, error } = await supabase
      .from('cron.job')
      .select('*')
      .order('jobname');

    if (error) {
      // If cron schema doesn't exist or no access, return job configs
      return NextResponse.json({
        jobs: Object.entries(SCHEDULED_JOBS).map(([key, config]) => ({
          id: key,
          ...config,
          enabled: false,
          lastRun: null,
          nextRun: null,
        })),
        message: 'pg_cron not configured. Jobs need to be scheduled manually.',
      });
    }

    // Map cron jobs to our job configurations
    const jobs = Object.entries(SCHEDULED_JOBS).map(([key, config]) => {
      const cronJob = cronJobs?.find(j => j.jobname === key);
      
      return {
        id: key,
        ...config,
        enabled: !!cronJob,
        jobId: cronJob?.jobid,
        lastRun: cronJob?.last_run,
        nextRun: cronJob?.next_run,
        active: cronJob?.active,
      };
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error fetching scheduled jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleData || roleData.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { action, jobId } = await request.json();

    if (!action || !jobId) {
      return NextResponse.json(
        { error: 'Missing action or jobId' },
        { status: 400 }
      );
    }

    const jobConfig = SCHEDULED_JOBS[jobId as keyof typeof SCHEDULED_JOBS];
    if (!jobConfig) {
      return NextResponse.json(
        { error: 'Invalid job ID' },
        { status: 400 }
      );
    }

    let result;

    switch (action) {
      case 'enable':
        // Schedule the job
        const { data: scheduleData, error: scheduleError } = await supabase.rpc(
          'cron_schedule',
          {
            job_name: jobId,
            schedule: jobConfig.schedule,
            command: jobConfig.command,
          }
        );

        if (scheduleError) {
          throw scheduleError;
        }

        result = { message: `Job ${jobId} scheduled successfully`, data: scheduleData };
        break;

      case 'disable':
        // Unschedule the job
        const { error: unscheduleError } = await supabase.rpc(
          'cron_unschedule',
          { job_name: jobId }
        );

        if (unscheduleError) {
          throw unscheduleError;
        }

        result = { message: `Job ${jobId} unscheduled successfully` };
        break;

      case 'run':
        // Run the job immediately
        const functionName = jobConfig.command
          .replace('SELECT ', '')
          .replace('();', '');
        
        const { data: runData, error: runError } = await supabase.rpc(functionName);

        if (runError) {
          throw runError;
        }

        // Log the manual run
        await supabase
          .from('audit_logs')
          .insert({
            tenant_id: user.user_metadata?.tenant_id,
            user_id: user.id,
            action: 'scheduled_job.manual_run',
            resource_type: 'scheduled_job',
            details: {
              job_id: jobId,
              job_name: jobConfig.name,
              run_at: new Date().toISOString(),
            },
          });

        result = { message: `Job ${jobId} executed successfully`, data: runData };
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error managing scheduled job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to manage scheduled job' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication and admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleData || roleData.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { error: 'Missing jobId' },
        { status: 400 }
      );
    }

    // Delete the job from cron
    const { error } = await supabase.rpc('cron_unschedule', { job_name: jobId });

    if (error) {
      throw error;
    }

    return NextResponse.json({ message: `Job ${jobId} deleted successfully` });
  } catch (error) {
    console.error('Error deleting scheduled job:', error);
    return NextResponse.json(
      { error: 'Failed to delete scheduled job' },
      { status: 500 }
    );
  }
}