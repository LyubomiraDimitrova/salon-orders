import { supabase } from './supabase-client.js';

export async function getApprovedAdminProfile(userId) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, approval_status')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return profile?.role === 'admin' && profile.approval_status === 'approved'
    ? profile
    : null;
}
