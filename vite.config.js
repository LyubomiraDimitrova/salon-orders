import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        catalog: fileURLToPath(new URL('./catalog.html', import.meta.url)),
        login: fileURLToPath(new URL('./login.html', import.meta.url)),
        register: fileURLToPath(new URL('./register.html', import.meta.url)),
        profile: fileURLToPath(new URL('./profile.html', import.meta.url)),
      },
    },
  },
});
