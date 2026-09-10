import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: Number(process.env.PORT || 8095), host: '127.0.0.1' },
});
