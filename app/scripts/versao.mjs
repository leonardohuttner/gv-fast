// Nova versão do GV Fast: sobe o número em app/package.json, faz o commit e cria a tag vX.Y.Z.
// Uso (dentro de app/):  npm run versao -- patch   (ou minor / major / 1.2.3)
// Necessário porque o `npm version` não faz commit/tag quando o package.json não está na raiz do git.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tipo = process.argv[2] || 'patch';
const git = (...args) => execFileSync('git', args, { stdio: 'pipe' }).toString().trim();

if (git('status', '--porcelain')) {
  console.error('Há alterações não commitadas. Faça o commit antes de criar uma versão.');
  process.exit(1);
}

execFileSync('npm', ['version', tipo, '--no-git-tag-version'], { stdio: 'inherit' });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;

git('add', 'package.json', 'package-lock.json');
git('commit', '-m', `Versão ${version}`);
git('tag', '-a', tag, '-m', `GV Fast ${version}`);

console.log(`\n${tag} criada. Para enviar ao GitHub:  git push --follow-tags`);
console.log('Para gerar os instaladores:            npm run dist:mac && npm run dist:win');
