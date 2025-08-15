import { NextRequest, NextResponse } from 'next/server';
import { 
  withAuth, 
  handleApiError,
  successResponse,
  validateTenantAccess,
  type ApiContext 
} from '@/lib/api/middleware';

// ============================================
// GET /api/customers/import/[jobId]/errors - Get import job errors
// ============================================
export const GET = withAuth(async (
  req: NextRequest,
  context: ApiContext,
  { params }: { params: { jobId: string } }
) => {
  try {
    const { supabase, tenantId } = context;
    const jobId = params.jobId;
    const { searchParams } = new URL(req.url);
    
    // Pagination parameters
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

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
      .select('id, tenant_id, status, errors, file_name, total_rows, failed_rows')
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

    // Get errors from the job
    const allErrors = job.errors || [];
    
    // Paginate errors
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedErrors = allErrors.slice(startIndex, endIndex);
    
    // Format errors for response
    const formattedErrors = paginatedErrors.map((error: any) => ({
      row_number: error.row,
      field: error.field || null,
      message: error.message,
      details: error.details || null,
    }));

    // Return paginated errors
    return successResponse({
      job_id: job.id,
      file_name: job.file_name,
      total_errors: allErrors.length,
      errors: formattedErrors,
      pagination: {
        page,
        limit,
        total: allErrors.length,
        total_pages: Math.ceil(allErrors.length / limit),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
});