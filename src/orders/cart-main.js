import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import '../styles/fonts.css';
import '../styles/main.css';
import '../styles/orders.css';

import { createFooter } from '../components/footer.js';
import { createHeader } from '../components/header.js';
import { createSupabaseConfigurationNotice } from '../components/supabase-configuration-notice.js';
import { supabaseConfigurationError } from '../services/supabase-client.js';
import { createCartPage } from './cart-page.js';

const app = document.querySelector('#app');
const pageContent = [createHeader({ currentPage: 'cart' })];

if (supabaseConfigurationError) {
  console.warn(`Supabase client is unavailable: ${supabaseConfigurationError}`);
  pageContent.push(createSupabaseConfigurationNotice(supabaseConfigurationError));
}

pageContent.push(createCartPage(), createFooter());
app.append(...pageContent);
