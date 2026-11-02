import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import './styles/main.css';

import { createFooter } from './components/footer.js';
import { createHeader } from './components/header.js';
import { createHomePage } from './pages/homePage.js';

const app = document.querySelector('#app');

app.append(createHeader(), createHomePage(), createFooter());
