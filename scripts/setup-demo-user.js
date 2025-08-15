const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function setupDemoUser() {
  try {
    console.log('Creating demo user...');
    
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: 'demo@flowtrack.app',
      password: 'demo123456',
      email_confirm: true,
      user_metadata: {
        full_name: 'Demo User'
      }
    });

    if (authError) {
      if (authError.message.includes('already exists')) {
        console.log('Demo user already exists in auth');
        
        // Get existing user
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const demoUser = users.find(u => u.email === 'demo@flowtrack.app');
        
        if (demoUser) {
          console.log('Demo user ID:', demoUser.id);
          return demoUser.id;
        }
      } else {
        throw authError;
      }
    } else {
      console.log('Demo auth user created:', authData.user.id);
      return authData.user.id;
    }
  } catch (error) {
    console.error('Error setting up demo user:', error);
    process.exit(1);
  }
}

setupDemoUser().then(() => {
  console.log('Demo user setup complete!');
  console.log('You can now login with:');
  console.log('Email: demo@flowtrack.app');
  console.log('Password: demo123456');
  process.exit(0);
});