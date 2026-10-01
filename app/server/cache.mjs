// Cache local de turmas e dias de aula (data/cache.json). Só códigos, datas e situação — nada de aluno.
// Serve para a agenda abrir na hora; é atualizado em segundo plano a cada login.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARQ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/cache.json');

let dados = null; // { turmas: { [ano]: Turma[] }, aulas: { [cpt]: Aula[] } }
let timer = null;

export async function cache() {
  if (!dados) {
    try { dados = JSON.parse(await readFile(ARQ, 'utf8')); } catch { dados = {}; }
    dados.turmas ??= {};
    dados.aulas ??= {};
  }
  return dados;
}

export function gravarDepois() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await mkdir(path.dirname(ARQ), { recursive: true });
    await writeFile(ARQ, JSON.stringify(dados));
  }, 500);
}
