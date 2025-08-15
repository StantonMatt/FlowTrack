/**
 * Test suite for overdue invoice detection and reminder system
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestResult {
  name: string;
  passed: boolean;
  details?: any;
  error?: string;
}

const tests: TestResult[] = [];

/**
 * Setup test data
 */
async function setupTestData() {
  const testTenantId = 'test-tenant-' + Date.now();
  const testCustomerId = 'test-customer-' + Date.now();
  
  try {
    // Create test tenant
    const { data: tenant } = await supabase
      .from('tenants')
      .insert({
        id: testTenantId,
        name: 'Test Tenant',
        settings: {
          timezone: 'America/New_York',
          billing_email: 'billing@test.com',
        },
      })
      .select()
      .single();

    // Create reminder settings
    await supabase
      .from('tenant_reminder_settings')
      .insert({
        tenant_id: testTenantId,
        enabled: true,
        reminder_intervals: [7, 14, 30],
        max_reminders: 3,
      });

    // Create test customer
    const { data: customer } = await supabase
      .from('customers')
      .insert({
        id: testCustomerId,
        tenant_id: testTenantId,
        full_name: 'Test Customer',
        email: 'customer@test.com',
        status: 'active',
      })
      .select()
      .single();

    return { tenantId: testTenantId, customerId: testCustomerId };
  } catch (error) {
    console.error('Setup failed:', error);
    throw error;
  }
}

/**
 * Test 1: Create overdue invoice and verify status change
 */
async function testOverdueStatusChange() {
  const testName = 'Overdue Status Change';
  
  try {
    const { tenantId, customerId } = await setupTestData();
    
    // Create an invoice that's 10 days overdue
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 10);
    
    const { data: invoice } = await supabase
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        invoice_number: 'TEST-001',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        subtotal: 100,
        total_amount: 100,
        status: 'sent',
        due_date: dueDate.toISOString().split('T')[0],
        issued_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Run overdue scan
    const response = await fetch(`${supabaseUrl}/functions/v1/scan-overdue-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId,
        dryRun: false,
      }),
    });

    const result = await response.json();
    
    // Verify invoice was marked as overdue
    const { data: updatedInvoice } = await supabase
      .from('invoices')
      .select('status, overdue_since')
      .eq('id', invoice.id)
      .single();

    tests.push({
      name: testName,
      passed: updatedInvoice?.status === 'overdue',
      details: {
        scanResult: result,
        invoiceStatus: updatedInvoice?.status,
      },
    });

    // Cleanup
    await cleanupTestData(tenantId);
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 2: Verify reminder intervals
 */
async function testReminderIntervals() {
  const testName = 'Reminder Intervals';
  
  try {
    const { tenantId, customerId } = await setupTestData();
    
    // Create invoices at different overdue periods
    const testCases = [
      { days: 7, shouldRemind: true, reminderNumber: 1 },
      { days: 14, shouldRemind: true, reminderNumber: 2 },
      { days: 30, shouldRemind: true, reminderNumber: 3 },
      { days: 5, shouldRemind: false, reminderNumber: 0 },
    ];

    const results = [];
    
    for (const testCase of testCases) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - testCase.days);
      
      const { data: invoice } = await supabase
        .from('invoices')
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          invoice_number: `TEST-${testCase.days}`,
          period_start: '2024-01-01',
          period_end: '2024-01-31',
          subtotal: 100,
          total_amount: 100,
          status: 'sent',
          due_date: dueDate.toISOString().split('T')[0],
          issued_at: new Date().toISOString(),
          reminder_count: 0,
        })
        .select()
        .single();

      // Check if reminder should be scheduled
      const { data: shouldRemind } = await supabase
        .rpc('should_schedule_reminder', {
          p_invoice_id: invoice.id,
          p_tenant_id: tenantId,
        });

      results.push({
        days: testCase.days,
        expected: testCase.shouldRemind,
        actual: shouldRemind,
        passed: shouldRemind === testCase.shouldRemind,
      });
    }

    const allPassed = results.every(r => r.passed);
    
    tests.push({
      name: testName,
      passed: allPassed,
      details: results,
    });

    // Cleanup
    await cleanupTestData(tenantId);
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 3: Max reminders limit
 */
async function testMaxRemindersLimit() {
  const testName = 'Max Reminders Limit';
  
  try {
    const { tenantId, customerId } = await setupTestData();
    
    // Create an overdue invoice with max reminders already sent
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 60);
    
    const { data: invoice } = await supabase
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        invoice_number: 'TEST-MAX',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        subtotal: 100,
        total_amount: 100,
        status: 'overdue',
        due_date: dueDate.toISOString().split('T')[0],
        issued_at: new Date().toISOString(),
        reminder_count: 3, // Max is 3 in our test settings
        last_reminded_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Run overdue scan
    const response = await fetch(`${supabaseUrl}/functions/v1/scan-overdue-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId,
        dryRun: true,
      }),
    });

    const result = await response.json();
    
    // Should not schedule more reminders
    const remindersScheduled = result.result?.remindersScheduled || 0;
    
    tests.push({
      name: testName,
      passed: remindersScheduled === 0,
      details: {
        reminderCount: invoice.reminder_count,
        remindersScheduled,
      },
    });

    // Cleanup
    await cleanupTestData(tenantId);
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 4: Reminder history tracking
 */
async function testReminderHistory() {
  const testName = 'Reminder History Tracking';
  
  try {
    const { tenantId, customerId } = await setupTestData();
    
    // Create an overdue invoice
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 7);
    
    const { data: invoice } = await supabase
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        invoice_number: 'TEST-HISTORY',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        subtotal: 100,
        total_amount: 100,
        status: 'sent',
        due_date: dueDate.toISOString().split('T')[0],
        issued_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Simulate reminder being sent
    await supabase
      .from('invoice_reminder_history')
      .insert({
        tenant_id: tenantId,
        invoice_id: invoice.id,
        customer_id: customerId,
        reminder_number: 1,
        days_overdue: 7,
        email_to: ['customer@test.com'],
        email_status: 'sent',
        email_message_id: 'test-message-id',
      });

    // Check history
    const { data: history } = await supabase
      .from('invoice_reminder_history')
      .select('*')
      .eq('invoice_id', invoice.id);

    tests.push({
      name: testName,
      passed: history && history.length === 1,
      details: {
        historyCount: history?.length,
        reminderNumber: history?.[0]?.reminder_number,
      },
    });

    // Cleanup
    await cleanupTestData(tenantId);
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Test 5: Dry run mode
 */
async function testDryRunMode() {
  const testName = 'Dry Run Mode';
  
  try {
    const { tenantId, customerId } = await setupTestData();
    
    // Create an overdue invoice
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 15);
    
    const { data: invoice } = await supabase
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        invoice_number: 'TEST-DRY',
        period_start: '2024-01-01',
        period_end: '2024-01-31',
        subtotal: 100,
        total_amount: 100,
        status: 'sent',
        due_date: dueDate.toISOString().split('T')[0],
        issued_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Run in dry run mode
    const response = await fetch(`${supabaseUrl}/functions/v1/scan-overdue-invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId,
        dryRun: true,
      }),
    });

    const result = await response.json();
    
    // Check that invoice status wasn't changed
    const { data: unchangedInvoice } = await supabase
      .from('invoices')
      .select('status, reminder_count')
      .eq('id', invoice.id)
      .single();

    tests.push({
      name: testName,
      passed: unchangedInvoice?.status === 'sent' && 
              (unchangedInvoice?.reminder_count || 0) === 0,
      details: {
        dryRunResult: result,
        invoiceStatus: unchangedInvoice?.status,
        reminderCount: unchangedInvoice?.reminder_count,
      },
    });

    // Cleanup
    await cleanupTestData(tenantId);
  } catch (error) {
    tests.push({
      name: testName,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Cleanup test data
 */
async function cleanupTestData(tenantId: string) {
  try {
    // Delete in order due to foreign key constraints
    await supabase
      .from('invoice_reminder_history')
      .delete()
      .eq('tenant_id', tenantId);
    
    await supabase
      .from('invoices')
      .delete()
      .eq('tenant_id', tenantId);
    
    await supabase
      .from('customers')
      .delete()
      .eq('tenant_id', tenantId);
    
    await supabase
      .from('tenant_reminder_settings')
      .delete()
      .eq('tenant_id', tenantId);
    
    await supabase
      .from('tenants')
      .delete()
      .eq('id', tenantId);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🧪 Running Overdue Detection Tests...\n');

  await testOverdueStatusChange();
  await testReminderIntervals();
  await testMaxRemindersLimit();
  await testReminderHistory();
  await testDryRunMode();

  // Print results
  console.log('\n📊 Test Results:\n');
  console.log('═'.repeat(60));

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const status = test.passed ? '✅' : '❌';
    console.log(`${status} ${test.name}`);
    
    if (!test.passed) {
      if (test.error) {
        console.log(`   Error: ${test.error}`);
      }
      if (test.details) {
        console.log(`   Details: ${JSON.stringify(test.details, null, 2)}`);
      }
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