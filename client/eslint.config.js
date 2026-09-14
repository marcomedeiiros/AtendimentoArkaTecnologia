/**
 * Linter do painel deliberadamente pequeno.
 *
 * ── POR QUE EXISTE ──────────────────────────────────────────────────────────
 *
 * A rede de verificação do projeto (`server/verificar-*.js`) é boa no que
 * cobre: regra de negócio medida contra o banco. Mas ela não enxerga uma classe
 * inteira de defeito do React a **dependência esquecida** num `useEffect` /
 * `useMemo` / `useCallback`. O sintoma não é um erro: é a tela usando um valor
 * velho e ninguém percebendo, porque nada estoura. É o tipo de defeito que só
 * aparece como "às vezes some" ou "só some depois que eu troco de aba".
 *
 * ── POR QUE SÓ ISTO ─────────────────────────────────────────────────────────
 *
 * Um preset completo (`eslint:recommended` + react + import) acende centenas de
 * avisos de estilo num código de 64 mil linhas que já funciona. Isso não
 * conserta nada e treina todo mundo a ignorar a saída do linter o mesmo mal
 * que um teste cronicamente vermelho causa.
 *
 * Então aqui ficam ligadas as regras que apontam DEFEITO, não gosto:
 *
 *   react-hooks/rules-of-hooks   hook dentro de if/loop quebra o React de fato
 *   react-hooks/exhaustive-deps  a dependência esquecida descrita acima
 *   no-undef                     variável que não existe = ReferenceError
 *   no-dupe-keys / no-dupe-args  a segunda chave apaga a primeira, em silêncio
 *   no-unreachable               código depois de return: ou é morto, ou é bug
 *   no-cond-assign               `if (a = b)` quase sempre é `==` esquecido
 *   no-constant-condition        `if (true)` num if de verdade
 *
 * `exhaustive-deps` entra como AVISO, e não erro, de propósito: parte dos
 * apontamentos dela exige decidir caso a caso (às vezes a dependência foi
 * omitida com razão). Aviso aparece, não bloqueia, e dá para atacar aos poucos.
 *
 * Uso:  cd client && npm run lint
 */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Defeito de verdade -- erro.
      'react-hooks/rules-of-hooks': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // `no-undef` precisa saber que JSX usa a variável do componente.
      'no-undef': 'error',

      // Exige decisão humana -- aviso.
      'react-hooks/exhaustive-deps': 'warn',
    },
    linterOptions: {
      // Um `eslint-disable` que não desliga nada é lixo que envelhece: ele fica
      // no arquivo depois que o problema já foi consertado, e o próximo leitor
      // acha que ainda existe um problema ali.
      reportUnusedDisableDirectives: true,
    },
  },
];
