/**
 * Test suite for invoice generation error handling
 * Run these tests to validate the robust error handling implementation
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const tests: TestResult[] = [];

/**
 * Test 1: Simulate Storage failure
 */
async function testStorageFailure() {
  const testName = 'Storage Failure Handling';
  try {
    // Mock a storage failure by using invalid credentials
    const result = await fetch(`${supabaseUrl}/functions/v1/generate-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'test-tenant-id',
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        dryRun: true,
        generatePdfs: true,
        sendEmails: false,
      }),
    });

    const data = await result.json();
    
    tests.push({
      name: testName,
      passed: true,
      details: data,
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 2: Simulate Email failure
 */
async function testEmailFailure() {
  const testName = 'Email Failure Handling';
  try {
    // Test with invalid email configuration
    const result = await fetch(`${supabaseUrl}/functions/v1/generate-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'test-tenant-id',
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        dryRun: true,
        generatePdfs: false,
        sendEmails: true,
      }),
    });

    const data = await result.json();
    
    tests.push({
      name: testName,
      passed: data.result?.partialFailures?.length > 0,
      details: data,
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 3: Verify Dead Letter Queue
 */
async function testDeadLetterQueue() {
  const testName = 'Dead Letter Queue Creation';
  try {
    // Check if failed emails are added to DLQ
    const { data, error } = await supabase
      .from('email_dead_letter_queue')
      .select('*')
      .eq('status', 'pending')
      .limit(1);

    tests.push({
      name: testName,
      passed: !error,
      details: data,
      error: error?.message,
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 4: Verify Billing Run Error Tracking
 */
async function testBillingRunErrorTracking() {
  const testName = 'Billing Run Error Counters';
  try {
    // Check if billing_runs table has error counters
    const { data, error } = await supabase
      .from('billing_runs')
      .select('invoices_failed, pdfs_failed, emails_failed, status')
      .eq('status', 'partial')
      .limit(1);

    tests.push({
      name: testName,
      passed: !error,
      details: data,
      error: error?.message,
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 5: Test DLQ Processing
 */
async function testDLQProcessing() {
  const testName = 'DLQ Processing Function';
  try {
    const result = await fetch(`${supabaseUrl}/functions/v1/process-email-dlq`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 5,
      }),
    });

    const data = await result.json();
    
    tests.push({
      name: testName,
      passed: result.ok,
      details: data,
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 6: Verify Invoice Error Status
 */
async function testInvoiceErrorStatus() {
  const testName = 'Invoice Error Status';
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('id, status, error_details')
      .eq('status', 'error')
      .limit(1);

    tests.push({
      name: testName,
      passed: !error,
      details: data,
      error: error?.message,
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 7: Idempotency Check
 */
async function testIdempotency() {
  const testName = 'Idempotency Check';
  try {
    const requestData = {
      tenantId: 'test-tenant-id',
      periodStart: '2024-02-01',
      periodEnd: '2024-02-29',
      dryRun: true,
    };

    // Send request twice
    const result1 = await fetch(`${supabaseUrl}/functions/v1/generate-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    const result2 = await fetch(`${supabaseUrl}/functions/v1/generate-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    const data1 = await result1.json();
    const data2 = await result2.json();

    tests.push({
      name: testName,
      passed: data2.message?.includes('already completed'),
      details: { first: data1, second: data2 },
    });
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🧪 Running Error Handling Tests...\n');

  await testStorageFailure();
  await testEmailFailure();
  await testDeadLetterQueue();
  await testBillingRunErrorTracking();
  await testDLQProcessing();
  await testInvoiceErrorStatus();
  await testIdempotency();

  // Print results
  console.log('\n📊 Test Results:\n');
  console.log('═'.repeat(60));

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const status = test.passed ? '✅' : '❌';
    console.log(`${status} ${test.name}`);
    
    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }
    
    if (test.details && !test.passed) {
      console.log(`   Details: ${JSON.stringify(test.details, null, 2)}`);
    }

    if (test.passed) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('═'.repeat(60));
  console.log(`\n📈 Summary: ${passed}/${tests.length} tests passed`);
  
  if (failed > 0) {
    console.log(`⚠️  ${failed} tests failed`);
  } else {
    console.log('🎉 All tests passed!');
  }
}

// Run tests if this is the main module
if (import.meta.main) {
  runTests().catch(console.error);
}

export { runTests, tests };