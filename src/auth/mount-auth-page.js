import { createFooter } from '../components/footer.js';
import { createHeader } from '../components/header.js';
import { createSupabaseConfigurationNotice } from '../components/supabase-configuration-notice.js';
import { supabaseConfigurationError } from '../services/supabase-client.js';

export async function mountAuthPage(currentPage, createPage) {
  const app = document.querySelector('#app');
  const pageContent = [createHeader({ currentPage })];

  if (supabaseConfigurationError) {
    console.warn(`Supabase client is unavailable: ${supabaseConfigurationError}`);
    pageContent.push(createSupabaseConfigurationNotice(supabaseConfigurationError));
  }

  pageContent.push(await createPage(), createFooter());
  app.append(...pageContent);
}
