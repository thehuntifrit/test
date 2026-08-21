export default {
  root: './',
  base: process.env.BASE_PATH || './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
};
