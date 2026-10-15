import { defineConfig } from 'vite-plus';

// Shared lint and format rules for all workspace packages.
export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    singleQuote: true,
    printWidth: 120,
  },
});
