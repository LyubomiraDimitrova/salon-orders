import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

function getConfigurationError() {
  if (!supabaseUrl || !supabasePublishableKey) {
    return 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.';
  }

  try {
    new URL(supabaseUrl);
  } catch {
    return 'VITE_SUPABASE_URL must be a valid URL.';
  }

  return null;
}

export const supabaseConfigurationError = getConfigurationError();
export const isSupabaseConfigured = supabaseConfigurationError === null;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;
