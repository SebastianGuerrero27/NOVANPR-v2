/**
 * ESLint (configuración plana) para el frontend: reglas recomendadas de JavaScript y de TypeScript,
 * y las de hooks de React (dependencias de efectos y orden de llamada).
 *   npm run lint
 */
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', 'scripts', '*.cjs', '*.mjs', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Quitar un campo de un objeto con el resto (`const { placa: _placa, ...datos }`) es un uso legítimo
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Los mensajes de error para el usuario reemplazan a propósito el error técnico del catch
      'preserve-caught-error': 'off',
    },
  },
);
