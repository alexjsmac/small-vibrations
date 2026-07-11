import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // .claude/** can contain unrelated local worktree checkouts (other
    // sessions' copies of this repo, possibly on stale branches) — never
    // present in a clean CI checkout, but must not pollute local `npm run
    // lint` runs on this machine.
    ignores: ['dist/**', 'public/**', 'node_modules/**', 'CC-Session-Logs/**', '.claude/**'],
  },
  js.configs.recommended,
  // NOT the typeChecked variant — keeps scripts/tests lintable without
  // wiring them into a tsconfig "project" for ESLint's type-aware parser.
  ...tseslint.configs.recommended,
  {
    // Browser app code.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // one deliberate `as any` on window.__sv
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // MicInput.ts assigns `let mic!: MicInput` after a closure that
      // captures it by reference — a legitimate forward-declaration
      // pattern the default (false) option would flag as prefer-const.
      'prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: true }],
    },
  },
  {
    // The match worker runs in a Worker global scope, not window.
    files: ['src/audio/match-worker.ts'],
    languageOptions: {
      globals: globals.worker,
    },
  },
  {
    // Offline/node-side scripts and config files.
    files: ['scripts/**/*.{ts,mjs,js}', '*.config.{ts,js}', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // scripts/build-fingerprints.ts has one pre-existing unused import
      // (FRAMES_PER_SECOND); demote to a warning like src/** rather than
      // editing an existing script file to satisfy a new lint rule.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Colocated unit tests + Playwright smoke specs.
    files: ['src/**/*.test.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // The smoke spec reaches into window.__sv, a debug hatch typed `any`
      // on purpose (see src/main.ts) — same rationale as the src/** rule.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  }
);
