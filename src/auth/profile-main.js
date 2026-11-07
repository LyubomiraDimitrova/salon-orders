import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import '../styles/fonts.css';
import '../styles/main.css';
import '../styles/auth.css';
import '../styles/price-lists.css';

import { createProfilePage } from './profile-page.js';
import { mountAuthPage } from './mount-auth-page.js';

mountAuthPage('profile', createProfilePage);
