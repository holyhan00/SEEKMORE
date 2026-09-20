import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import postcssTailwind from '@tailwindcss/postcss';
import type { AcceptedPlugin } from 'postcss';
import { fileURLToPath, URL } from 'node:url';


const projectRoot = fileURLToPath(new URL('.', import.meta.url));


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET?.trim();


  return {
    base: './',


    plugins: [react()],


    css: {
      postcss: {
        plugins: [
          postcssTailwind() as AcceptedPlugin,
        ],
      },
    },


    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },


    publicDir: 'public',


    server: {
      proxy: devProxyTarget
        ? {
            '/api': {
              target: devProxyTarget,
              changeOrigin: true,
            },
            '/socket.io': {
              target: devProxyTarget,
              changeOrigin: true,
              ws: true,
            },
          }
        : undefined,
    },
  };
});