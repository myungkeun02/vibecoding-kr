import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  security: {
    allowedDomains: [
      { hostname: 'vibepan.com', protocol: 'https' },
      { hostname: 'admin.vibepan.com', protocol: 'https' },
      { hostname: 'www.vibepan.com', protocol: 'https' },
      { hostname: 'vibecoding-kr-production.up.railway.app', protocol: 'https' },
      { hostname: 'localhost', protocol: 'http' },
      { hostname: '127.0.0.1', protocol: 'http' },
      { hostname: '127.0.0.1', protocol: 'https' },
    ],
  },
  server: { port: Number(process.env.PORT || 8095), host: '127.0.0.1' },
});
