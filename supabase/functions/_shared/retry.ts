export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
}

export class RetryError extends Error {
  public attempts: number;
  public lastError: any;
  public errors: any[];

  constructor(message: string, attempts: number, errors: any[]) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.errors = errors;
    this.lastError = errors[errors.length - 1];
  }
}

/**
 * Execute a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry,
  } = options;

  const errors: any[] = [];
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      errors.push(error);
      
      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw new RetryError(
          `Failed after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`,
          attempt,
          errors
        );
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs
      );
      
      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.3 * delay;
      const totalDelay = delay + jitter;
      
      console.log(`Retry attempt ${attempt}/${maxAttempts} after ${Math.round(totalDelay)}ms`);
      await sleep(totalDelay);
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw new RetryError('Unexpected retry failure', maxAttempts, errors);
}

/**
 * Default retry predicate - retry on network errors and 5xx status codes
 */
function defaultShouldRetry(error: any, attempt: number): boolean {
  // Always retry on network errors
  if (error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED') {
    return true;
  }
  
  // Retry on 5xx errors (server errors) and 429 (rate limit)
  if (error.status >= 500 || error.status === 429) {
    return true;
  }
  
  // Retry on specific Supabase/Postgres errors
  if (error.code === '40001' || // Serialization failure
      error.code === '40P01' || // Deadlock detected
      error.code === '57014' || // Query canceled
      error.code === '08006' || // Connection failure
      error.code === '08003' || // Connection does not exist
      error.code === '08001') { // Unable to establish connection
    return true;
  }
  
  // Don't retry on client errors (4xx except 429)
  if (error.status >= 400 && error.status < 500) {
    return false;
  }
  
  // Default to not retrying after 3 attempts
  return attempt < 3;
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Batch processor with retry logic
 */
export async function processBatchWithRetry<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: {
    concurrency?: number;
    retryOptions?: RetryOptions;
    onError?: (item: T, error: any) => void;
  } = {}
): Promise<{
  successful: Array<{ item: T; result: R }>;
  failed: Array<{ item: T; error: any }>;
}> {
  const {
    concurrency = 5,
    retryOptions = {},
    onError = () => {},
  } = options;
  
  const successful: Array<{ item: T; result: R }> = [];
  const failed: Array<{ item: T; error: any }> = [];
  
  // Process in chunks for concurrency control
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    
    await Promise.all(
      chunk.map(async (item) => {
        try {
          const result = await withRetry(
            () => processor(item),
            retryOptions
          );
          successful.push({ item, result });
        } catch (error) {
          failed.push({ item, error });
          onError(item, error);
        }
      })
    );
  }
  
  return { successful, failed };
}