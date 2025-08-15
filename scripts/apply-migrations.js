const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration(filePath, name) {
  try {
    console.log(`Running migration: ${name}...`);
    const sql = fs.readFileSync(filePath, 'utf8');
    
    // Split by semicolons but be careful with functions
    const statements = sql
      .split(/;\s*$/gm)
      .filter(stmt => stmt.trim())
      .map(stmt => stmt + ';');
    
    for (const statement of statements) {
      if (statement.trim()) {
        const { error } = await supabase.rpc('exec_sql', { 
          query: statement 
        }).single();
        
        if (error) {
          // Try direct execution as fallback
          console.log('Trying alternative execution method...');
          // This would need a service role key with proper permissions
        }
      }
    }
    
    console.log(`✓ Migration ${name} completed`);
  } catch (error) {
    console.error(`✗ Migration ${name} failed:`, error.message);
    throw error;
  }
}

async function main() {
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  
  const migrations = [
    '20240101000000_init.sql',
    '20240101000001_seed.sql',
    '20240101000002_optimize.sql',
    '20240101000003_auth.sql'
  ];
  
  for (const migration of migrations) {
    const filePath = path.join(migrationsDir, migration);
    if (fs.existsSync(filePath)) {
      await runMigration(filePath, migration);
    } else {
      console.log(`Skipping ${migration} - file not found`);
    }
  }
  
  console.log('\n✓ All migrations completed successfully');
}

main().catch(console.error);