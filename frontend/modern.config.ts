import { appTools, defineConfig } from '@modern-js/app-tools';
import { tailwindcssPlugin } from '@modern-js/plugin-tailwindcss';
import dotenv from 'dotenv';

const customEnv = {};

dotenv.config({ processEnv: customEnv });

// https://modernjs.dev/en/configure/app/usage
export default defineConfig({
  runtime: {
    router: true,
  },
  plugins: [
    appTools({
      bundler: 'webpack', // Set to 'experimental-rspack' to enable rspack ⚡️🦀
    }),
    tailwindcssPlugin(),
  ],
  source: {
    globalVars: {
      'process.env.CONFIG': customEnv, // use process.env.CONFIG.EXAMPLE_KEY to access
    },
  },
  dev: {
    port: 11450,
  },
  server: {
    port: 8866, // production build
  },
  html: {
    favicon: './src/assets/favicon.ico',
    appIcon: './src/assets/favicon.ico',
    title: '3D Data Protection',
  },
  tools: {
    webpack: {
      watchOptions: {
        ignored: /node_modules/,
      },
    },
  },
});
