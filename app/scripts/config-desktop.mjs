// Gera electron/config.json (fora do git) a partir do app/.env, para o build de desktop do próprio professor.
// A unidade não fica no código nem no repositório — só no instalador gerado localmente.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const unidade = (env.match(/^\s*GV_UNIDADE\s*=\s*([0-9]+,[0-9]+)\s*$/m) || [])[1] || process.env.GV_UNIDADE;
if (!unidade) {
  console.error('Defina GV_UNIDADE no app/.env (ex.: GV_UNIDADE=1,10) antes de gerar o app de desktop.');
  process.exit(1);
}
writeFileSync('electron/config.json', JSON.stringify({ GV_UNIDADE: unidade }, null, 2));
console.log('electron/config.json gerado.');
