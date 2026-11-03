import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import '../styles/main.css';
import '../styles/catalog.css';

import { createCatalogPage } from './catalog-page.js';
import { createFooter } from '../components/footer.js';
import { createHeader } from '../components/header.js';
import { createSupabaseConfigurationNotice } from '../components/supabase-configuration-notice.js';
import { supabaseConfigurationError } from '../services/supabase-client.js';

const app = document.querySelector('#app');
const pageContent = [createHeader({ currentPage: 'catalog' })];

if (supabaseConfigurationError) {
  console.warn(`Supabase client is unavailable: ${supabaseConfigurationError}`);
  pageContent.push(createSupabaseConfigurationNotice(supabaseConfigurationError));
}

pageContent.push(createCatalogPage(), createFooter());
app.append(...pageContent);
