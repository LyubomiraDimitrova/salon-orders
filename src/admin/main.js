import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import '../styles/fonts.css';
import '../styles/main.css';
import '../styles/admin.css';

import { createFooter } from '../components/footer.js';
import { createHeader } from '../components/header.js';
import { createSupabaseConfigurationNotice } from '../components/supabase-configuration-notice.js';
import { supabaseConfigurationError } from '../services/supabase-client.js';
import { createAdminPage } from './admin-page.js';

const app = document.querySelector('#app');
const pageContent = [createHeader({ currentPage: 'admin' })];

if (supabaseConfigurationError) {
  console.warn(`Supabase client is unavailable: ${supabaseConfigurationError}`);
  pageContent.push(createSupabaseConfigurationNotice(supabaseConfigurationError));
}

pageContent.push(await createAdminPage(), createFooter());
app.append(...pageContent);
