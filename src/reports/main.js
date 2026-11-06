import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import '../styles/fonts.css';
import '../styles/main.css';
import '../styles/reports.css';

import { createFooter } from '../components/footer.js';
import { createHeader } from '../components/header.js';
import { createSupabaseConfigurationNotice } from '../components/supabase-configuration-notice.js';
import { supabaseConfigurationError } from '../services/supabase-client.js';
import { createReportsPage } from './reports-page.js';

const app = document.querySelector('#app');
const content = [createHeader({ currentPage: 'reports' })];

if (supabaseConfigurationError) {
  content.push(createSupabaseConfigurationNotice(supabaseConfigurationError));
}

content.push(await createReportsPage(), createFooter());
app.append(...content);
