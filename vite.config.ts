import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignorePatterns: ['dist/**', 'vendor/**', '.agents/**', 'bun.lock'],
    singleQuote: true,
    trailingComma: 'es5',
    printWidth: 100,
  },
  lint: {
    ignorePatterns: ['dist/**', 'vendor/**', '.agents/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
