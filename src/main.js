import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import './styles/main.css';

import { createFooter } from './components/footer.js';
import { createHeader } from './components/header.js';
import { createHomePage } from './pages/homePage.js';
import { createSupabaseConfigurationNotice } from './components/supabase-configuration-notice.js';
import { supabaseConfigurationError } from './services/supabase-client.js';

const app = document.querySelector('#app');

const pageContent = [createHeader()];

if (supabaseConfigurationError) {
  console.warn(`Supabase client is unavailable: ${supabaseConfigurationError}`);
  pageContent.push(createSupabaseConfigurationNotice(supabaseConfigurationError));
}

pageContent.push(createHomePage(), createFooter());
app.append(...pageContent);
