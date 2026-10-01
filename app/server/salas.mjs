// Salas virtuais: turmas que o portal separou mas são a mesma sala física.
// Guardadas em data/salas.json (só códigos de turma; nada de aluno/senha).
// Turma: { turma, ano, periodo, cpt (codigoProfessorTurma), cod (codigoturma), disciplina, curso, sala }
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ARQ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/salas.json');

// { salas, recusados, ocultas } — recusados = vínculos automáticos desfeitos; ocultas = turmas que não são do professor (ex.: substituição)
let dados = null;

const chave = (turmas) => turmas.map((t) => String(t.cpt)).sort().join('+');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function carregar() {
  if (dados) return dados;
  try {
    const lido = JSON.parse(await readFile(ARQ, 'utf8'));
    dados = Array.isArray(lido) ? { salas: lido } : lido;
  } catch {
    dados = {};
  }
  dados.salas ??= [];
  dados.recusados ??= [];
  dados.ocultas ??= [];
  return dados;
}

async function gravar() {
  await mkdir(path.dirname(ARQ), { recursive: true });
  await writeFile(ARQ, JSON.stringify(dados, null, 2));
}

export async function listarSalas() {
  return (await carregar()).salas;
}

export async function listarOcultas() {
  return new Set((await carregar()).ocultas);
}

export async function ocultarTurmas(cpts, ocultar) {
  await carregar();
  const set = new Set(dados.ocultas);
  for (const c of cpts) ocultar ? set.add(String(c)) : set.delete(String(c));
  dados.ocultas = [...set];
  await gravar();
}

export async function criarSala(nome, turmas, auto = false) {
  await carregar();
  const cpts = new Set(turmas.map((t) => String(t.cpt)));
  // uma turma só pode estar em uma sala
  dados.salas = dados.salas.map((s) => ({ ...s, turmas: s.turmas.filter((t) => !cpts.has(String(t.cpt))) })).filter((s) => s.turmas.length > 1);
  dados.recusados = dados.recusados.filter((k) => k !== chave(turmas));
  const sala = { id: randomUUID().slice(0, 8), nome, turmas, ...(auto && { auto: true }) };
  dados.salas.push(sala);
  await gravar();
  return sala;
}

export async function removerSala(id) {
  await carregar();
  const sala = dados.salas.find((s) => s.id === id);
  if (sala) dados.recusados.push(chave(sala.turmas));
  dados.salas = dados.salas.filter((s) => s.id !== id);
  await gravar();
}

// Junta sozinho turmas que são a mesma sala: mesma disciplina e curso, códigos de turma diferentes
// e pelo menos um dia de aula em comum. Não recria vínculos que o professor desfez.
export async function agruparAutomatico(turmas, aulasPorCpt) {
  await carregar();
  const agrupadas = new Set(dados.salas.flatMap((s) => s.turmas.map((t) => String(t.cpt))));
  const porDisciplina = new Map();
  for (const t of turmas) {
    if (agrupadas.has(String(t.cpt)) || dados.ocultas.includes(String(t.cpt)) || !aulasPorCpt[t.cpt]?.length) continue;
    const k = `${norm(t.disciplina)}|${norm(t.curso)}`;
    if (!porDisciplina.has(k)) porDisciplina.set(k, []);
    porDisciplina.get(k).push(t);
  }
  let criadas = 0;
  for (const lista of porDisciplina.values()) {
    if (lista.length < 2) continue;
    const dias = (t) => new Set(aulasPorCpt[t.cpt].filter((a) => a.situacao !== 2).map((a) => a.data));
    const juntas = lista.filter((t, i) => lista.some((o, j) => j !== i && o.turma.trim() !== t.turma.trim() && [...dias(t)].some((d) => dias(o).has(d))));
    if (juntas.length < 2 || new Set(juntas.map((t) => t.turma.trim())).size !== juntas.length) continue;
    if (dados.recusados.includes(chave(juntas))) continue;
    await criarSala(juntas[0].disciplina, juntas, true);
    criadas++;
  }
  return criadas;
}
