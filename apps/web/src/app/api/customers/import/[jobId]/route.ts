import { NextRequest, NextResponse } from 'next/server';
import { 
  withAuth, 
  handleApiError,
  successResponse,
  validateTenantAccess,
  type ApiContext 
} from '@/lib/api/middleware';

// ============================================
// GET /api/customers/import/[jobId] - Get import job status
// ============================================
export const GET = withAuth(async (
  req: NextRequest,
  context: ApiContext,
  { params }: { params: { jobId: string } }
) => {
  try {
    const { supabase, tenantId } = context;
    const jobId = params.jobId;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      return NextResponse.json(
        { error: 'Invalid job ID format' },
        { status: 400 }
      );
    }

    // Fetch import job
    const { data: job, error } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Import job not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    // Validate tenant access
    if (!validateTenantAccess(job, tenantId)) {
      return NextResponse.json(
        { error: 'Import job not found' },
        { status: 404 }
      );
    }

    // Calculate progress percentage
    const progress = job.total_rows > 0 
      ? Math.round((job.processed_rows / job.total_rows) * 100)
      : 0;

    // Return job status
    return successResponse({
      id: job.id,
      status: job.status,
      file_name: job.file_name,
      total_rows: job.total_rows,
      processed_rows: job.processed_rows,
      successful_rows: job.successful_rows,
      failed_rows: job.failed_rows,
      progress,
      started_at: job.started_at,
      completed_at: job.completed_at,
      created_at: job.created_at,
      error_count: job.errors?.length || 0,
      has_errors: (job.errors?.length || 0) > 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================
// POST /api/customers/import/[jobId] - Cancel import job
// ============================================
export const POST = withAuth(async (
  req: NextRequest,
  context: ApiContext,
  { params }: { params: { jobId: string } }
) => {
  try {
    const { supabase, tenantId, user } = context;
    const jobId = params.jobId;
    
    // Parse action from body
    const body = await req.json();
    const action = body.action;

    if (action !== 'cancel') {
      return NextResponse.json(
        { error: 'Invalid action. Only "cancel" is supported' },
        { status: 400 }
      );
    }

    // Check if job exists and belongs to tenant
    const { data: job, error: fetchError } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return NextResponse.json(
        { error: 'Import job not found' },
        { status: 404 }
      );
    }

    if (!validateTenantAccess(job, tenantId)) {
      return NextResponse.json(
        { error: 'Import job not found' },
        { status: 404 }
      );
    }

    // Check if job can be cancelled
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return NextResponse.json(
        { error: `Cannot cancel job with status: ${job.status}` },
        { status: 400 }
      );
    }

    // Cancel the job
    const { data: updatedJob, error: updateError } = await supabase
      .from('import_jobs')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log audit event
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: user.id,
      action: 'import.cancel',
      resource_type: 'import_job',
      resource_id: jobId,
    });

    return successResponse({
      message: 'Import job cancelled',
      job: {
        id: updatedJob.id,
        status: updatedJob.status,
        cancelled_at: updatedJob.completed_at,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
});