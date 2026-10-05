// Servidor local: API para o front Vue + Vite (dev) ou dist/ (produção).
// Escuta só em 127.0.0.1. Sessão do portal fica em memória; reiniciar = novo login.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Portal, SessaoExpirada } from './portal.mjs';
import { listarSalas, criarSala, removerSala, agruparAutomatico, listarOcultas, ocultarTurmas } from './salas.mjs';
import { cache, gravarDepois } from './cache.mjs';
import { visao, montar, chaveIndicador } from './avaliacoes.mjs';
import { visaoNotas, aplicarNotas } from './notas.mjs';

const PORT = Number(process.env.PORT) || 5180;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.env.NODE_ENV !== 'production';

let portal = new Portal();

const lerJson = (req) => new Promise((ok, erro) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { erro(e); } });
});
const enviar = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const dataValida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

const isoLocal = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const hoje = () => isoLocal(new Date());
const somarDias = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoLocal(d); };
const anosPadrao = () => { const a = new Date().getFullYear(); return [String(a - 1), String(a), String(a + 1)]; };

// ---------- Turmas e dias de aula (com cache em disco) ----------
async function turmasDoAno(ano, forcar = false) {
  const c = await cache();
  if (forcar || !c.turmas[ano]) { c.turmas[ano] = await portal.listarTurmas(ano); gravarDepois(); }
  return c.turmas[ano];
}
async function todasTurmas() {
  const out = [];
  for (const ano of anosPadrao()) out.push(...await turmasDoAno(ano));
  return out;
}
async function aulasDaTurma(t, forcar = false) {
  const c = await cache();
  if (forcar || !c.aulas[t.cpt]) { c.aulas[t.cpt] = await portal.aulas(t); gravarDepois(); }
  return c.aulas[t.cpt];
}

// Vincula sozinho as salas divididas a partir das turmas e datas já conhecidas
async function vincularAuto() {
  return agruparAutomatico(await todasTurmas(), (await cache()).aulas);
}

function resumir(aulas) {
  const h = hoje();
  const ativas = aulas.filter((a) => a.situacao !== 2);
  return {
    inicio: aulas[0]?.data ?? null, fim: aulas.at(-1)?.data ?? null, total: ativas.length,
    realizadas: ativas.filter((a) => a.situacao === 1).length,
    pendentes: ativas.filter((a) => a.situacao === 0 && a.data <= h).length,
    proxima: ativas.find((a) => a.situacao === 0)?.data ?? null,
  };
}

// Atualização em segundo plano depois do login: lista de turmas + dias de aula de cada uma.
// Uma turma por vez; pedidos do usuário entram na fila entre uma turma e outra.
let atualizacao = { rodando: false, inicial: false, etapa: '', feitas: 0, total: 0, em: null };
async function atualizarTudo() {
  if (atualizacao.rodando) return;
  const p = portal;
  atualizacao = { rodando: true, inicial: true, etapa: 'turmas', feitas: 0, total: 0, em: null };
  try {
    const c = await cache();
    atualizacao.inicial = !Object.keys(c.aulas).length; // sem cache: a agenda ainda não tem nada para mostrar
    const turmas = [];
    for (const ano of anosPadrao()) turmas.push(...await turmasDoAno(ano, true));
    const limite = somarDias(hoje(), -30);
    const encerrada = (a) => a?.length && a.at(-1).data < limite && !a.some((x) => x.situacao === 0);
    const ocultas = await listarOcultas();
    const fila = turmas.filter((t) => !ocultas.has(t.cpt) && !encerrada(c.aulas[t.cpt]))
      .sort((a, b) => (c.aulas[a.cpt] ? 1 : 0) - (c.aulas[b.cpt] ? 1 : 0) || b.ano.localeCompare(a.ano));
    atualizacao.total = fila.length;
    atualizacao.etapa = 'aulas';
    for (const t of fila) {
      if (portal !== p || !p.logado) return;
      try { await aulasDaTurma(t, true); } catch (e) {
        if (e instanceof SessaoExpirada) { p.logado = false; return; }
        console.error(`[atualização] ${t.turma}: ${e.message}`);
      }
      atualizacao.feitas++;
    }
    await vincularAuto();
  } catch (e) {
    console.error(`[atualização] ${e.message}`);
  } finally {
    atualizacao.rodando = false;
    atualizacao.em = new Date().toISOString();
  }
}

// ---------- Salas ----------
// Sala = grupo salvo, ou "t-<cpt>" para uma turma sozinha
async function acharSala(id) {
  const grupo = (await listarSalas()).find((s) => s.id === id);
  if (grupo) return grupo;
  const cpt = id.startsWith('t-') && id.slice(2);
  const t = cpt && (await todasTurmas()).find((x) => x.cpt === cpt);
  return t ? { id, nome: t.disciplina, turmas: [t] } : null;
}
const salaPublica = ({ id, nome, turmas }, situacao) => ({ id, nome, situacao, turmas: turmas.map(({ turma, sala, periodo, cpt, disciplina }) => ({ turma, sala, periodo, cpt, disciplina })) });

// Situação da sala pelas datas em cache: andamento | futura | encerrada | sem-aulas
function situacaoSala(sala, aulasPorCpt) {
  const h = hoje();
  const aulas = sala.turmas.flatMap((t) => aulasPorCpt[t.cpt] ?? []).filter((a) => a.situacao !== 2);
  if (!aulas.length) return { estado: 'sem-aulas' };
  const datas = aulas.map((a) => a.data).sort();
  const pendentes = aulas.filter((a) => a.situacao === 0 && a.data <= h).length;
  const inicio = datas[0];
  const fim = datas.at(-1);
  const estado = fim < h && !pendentes ? 'encerrada' : inicio > h ? 'futura' : 'andamento';
  return { estado, inicio, fim, pendentes };
}

// Agenda: aulas de todas as turmas agrupadas por dia e sala. Inclui pendências dos últimos 60 dias.
async function agenda(de, ate) {
  await vincularAuto();
  const c = await cache();
  const grupos = await listarSalas();
  const grupoDe = new Map(grupos.flatMap((g) => g.turmas.map((t) => [t.cpt, g])));
  const ocultas = await listarOcultas();
  const h = hoje();
  const limitePend = somarDias(h, -60);
  const itens = new Map();
  for (const t of await todasTurmas()) {
    if (ocultas.has(t.cpt)) continue;
    for (const a of c.aulas[t.cpt] ?? []) {
      if (a.situacao === 2 || a.data > ate) continue;
      const atrasada = a.situacao === 0 && a.data < h && a.data >= limitePend;
      if (a.data < de && !atrasada) continue;
      const g = grupoDe.get(t.cpt);
      const salaId = g ? g.id : `t-${t.cpt}`;
      const k = `${a.data}|${salaId}`;
      const item = itens.get(k) ?? { data: a.data, salaId, nome: g?.nome ?? t.disciplina, turno: a.turno, periodos: a.periodos.length, situacao: a.situacao, turmas: [] };
      item.turmas.push({ cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, periodo: t.periodo });
      item.situacao = Math.min(item.situacao, a.situacao);
      itens.set(k, item);
    }
  }
  return [...itens.values()].sort((a, b) => a.data.localeCompare(b.data) || a.nome.localeCompare(b.nome));
}

// ---------- Chamada ----------
function linhas(t, alunos) {
  return alunos.map((a) => ({
    cpt: t.cpt, turma: t.turma, sala: t.sala, enturmacao: a.enturmacao, nome: a.nome, matricula: a.matricula,
    situacaoAluno: a.descricaoResultado, percentual: a.percentual, totalFaltas: a.totalFaltas, editAfast: a.editAfast,
    pode: a.permiteDigitarFrequencia == 1,
    periodos: Object.values(a.periodos || {}).sort((x, y) => x.periodo - y.periodo).map((p) => ({
      periodo: p.periodo, diarioClasse: p.diarioClasse, diarioClasseAluno: p.diarioClasseAluno,
      enturmacaoVinculo: p.enturmacaoVinculo, justificativaFalta: p.justificativaFalta,
      turmaHorariosEad: p.turmaHorariosEad, situacao: p.situacao, valor: p.indicadorPresenca,
    })),
  }));
}

async function lerSala(sala, data) {
  const todas = [];
  for (const t of sala.turmas) todas.push(...linhas(t, await portal.lerChamada(t, data)));
  return todas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Módulo da turma num dia (observações são por módulo)
async function moduloDe(t, data) {
  const aulas = await aulasDaTurma(t);
  return (aulas.find((a) => a.data === data) ?? aulas.findLast((a) => a.data <= (data || hoje())) ?? aulas[0])?.modulo ?? 1;
}

// ---------- API ----------
async function api(req, res, url) {
  const rota = `${req.method} ${url.pathname}`;

  if (rota === 'POST /api/login') {
    const { cpf, senha } = await lerJson(req);
    if (!cpf || !senha) return enviar(res, 400, { erro: 'Informe CPF e senha.' });
    portal = new Portal();
    const info = await portal.login(cpf, senha);
    atualizarTudo();
    return enviar(res, 200, { ok: true, ...info });
  }
  if (rota === 'GET /api/sessao') return enviar(res, 200, { logado: portal.logado });
  if (rota === 'POST /api/logout') { portal = new Portal(); return enviar(res, 200, { ok: true }); }

  if (!portal.logado) return enviar(res, 401, { erro: 'Faça login.' });

  if (rota === 'GET /api/agenda') {
    const de = url.searchParams.get('de') || hoje();
    const ate = url.searchParams.get('ate') || somarDias(hoje(), 21);
    return enviar(res, 200, { hoje: hoje(), itens: await agenda(de, ate), atualizacao });
  }

  // Salas para a chamada: grupos salvos + cada turma sem grupo
  if (rota === 'GET /api/salas') {
    await vincularAuto();
    const grupos = await listarSalas();
    const agrupadas = new Set(grupos.flatMap((s) => s.turmas.map((t) => t.cpt)));
    const ocultas = await listarOcultas();
    const sozinhas = (await todasTurmas()).filter((t) => !agrupadas.has(t.cpt) && !ocultas.has(t.cpt)).map((t) => ({ id: `t-${t.cpt}`, nome: t.disciplina, turmas: [t] }));
    const c = await cache();
    const ordem = { andamento: 0, futura: 1, 'sem-aulas': 2, encerrada: 3 };
    const lista = [...grupos, ...sozinhas].map((s) => salaPublica(s, situacaoSala(s, c.aulas)));
    lista.sort((a, b) => ordem[a.situacao.estado] - ordem[b.situacao.estado] || (a.situacao.inicio ?? '').localeCompare(b.situacao.inicio ?? '') || a.nome.localeCompare(b.nome));
    return enviar(res, 200, lista);
  }
  if (rota === 'POST /api/salas') {
    const { nome, cpts = [] } = await lerJson(req);
    const todas = await todasTurmas();
    const turmas = cpts.map((c) => todas.find((t) => t.cpt === String(c))).filter(Boolean);
    if (turmas.length < 2) return enviar(res, 400, { erro: 'Escolha pelo menos 2 turmas.' });
    const nova = await criarSala(nome || turmas[0].disciplina, turmas);
    return enviar(res, 200, salaPublica(nova, situacaoSala(nova, (await cache()).aulas)));
  }
  const del = req.method === 'DELETE' && url.pathname.match(/^\/api\/salas\/([\w-]+)$/);
  if (del) { await removerSala(del[1]); return enviar(res, 200, { ok: true }); }

  // Turmas do professor por ano, com a sala (grupo) de cada uma
  if (rota === 'GET /api/turmas') {
    await vincularAuto();
    const c = await cache();
    const grupos = await listarSalas();
    const ocultas = await listarOcultas();
    const out = [];
    for (const t of await todasTurmas()) {
      const g = grupos.find((s) => s.turmas.some((x) => x.cpt === t.cpt));
      out.push({ ...t, oculta: ocultas.has(t.cpt), grupo: g ? { id: g.id, nome: g.nome } : null, resumo: c.aulas[t.cpt] ? resumir(c.aulas[t.cpt]) : null });
    }
    return enviar(res, 200, { anos: anosPadrao(), turmas: out });
  }
  if (rota === 'POST /api/turmas/ocultar') {
    const { cpts = [], ocultar = true } = await lerJson(req);
    await ocultarTurmas(cpts, ocultar);
    return enviar(res, 200, { ok: true });
  }
  // Plano de uma turma qualquer (para reaproveitar textos)
  const pt = url.pathname.match(/^\/api\/turmas\/(\d+)\/plano$/);
  if (pt && req.method === 'GET') {
    const t = (await todasTurmas()).find((x) => x.cpt === pt[1]);
    if (!t) return enviar(res, 404, { erro: 'Turma não encontrada.' });
    return enviar(res, 200, await portal.lerPlano(t));
  }

  const rs = url.pathname.match(/^\/api\/turmas\/(\d+)\/resumo$/);
  if (rs && req.method === 'GET') {
    const t = (await todasTurmas()).find((x) => x.cpt === rs[1]);
    if (!t) return enviar(res, 404, { erro: 'Turma não encontrada.' });
    return enviar(res, 200, resumir(await aulasDaTurma(t)));
  }

  const m = url.pathname.match(/^\/api\/salas\/([\w-]+)\/(aulas|chamada|observacoes|resultado|avaliacoes|plano|notas)$/);
  const sala = m && await acharSala(m[1]);
  if (m && !sala) return enviar(res, 404, { erro: 'Sala não encontrada.' });

  // Dias de aula da sala (união das turmas). situacao do dia = pior entre as turmas.
  if (m && m[2] === 'aulas' && req.method === 'GET') {
    const dias = new Map();
    for (const t of sala.turmas) {
      for (const a of await aulasDaTurma(t, true)) {
        const d = dias.get(a.data) || { data: a.data, turno: a.turno, turmas: [] };
        d.turmas.push({ turma: t.turma, situacao: a.situacao, periodos: a.periodos.length });
        dias.set(a.data, d);
      }
    }
    const lista = [...dias.values()].sort((a, b) => a.data.localeCompare(b.data)).map((d) => {
      const ativas = d.turmas.filter((t) => t.situacao !== 2);
      return { ...d, situacao: ativas.length ? Math.min(...ativas.map((t) => t.situacao)) : 2 };
    });
    return enviar(res, 200, { aulas: lista });
  }

  if (m && m[2] === 'chamada') {
    if (req.method === 'GET') {
      const data = url.searchParams.get('data');
      if (!dataValida(data)) return enviar(res, 400, { erro: 'Data inválida.' });
      return enviar(res, 200, { alunos: await lerSala(sala, data) });
    }

    if (req.method === 'POST') {
      const { data, alunos = [] } = await lerJson(req);
      if (!dataValida(data)) return enviar(res, 400, { erro: 'Data inválida.' });
      const enviados = [];
      for (const t of sala.turmas) {
        const daTurma = alunos.filter((a) => String(a.cpt) === String(t.cpt));
        if (!daTurma.length) continue;
        await portal.salvarChamada(t, data, daTurma);
        enviados.push({ turma: t.turma, alunos: daTurma.length });
      }
      // Conferência obrigatória: relê e compara com o que foi marcado
      const esperado = new Map(alunos.flatMap((a) => a.periodos.map((p) => [`${a.enturmacao}:${p.diarioClasse}`, p.valor])));
      const atual = await lerSala(sala, data);
      const divergencias = [];
      for (const a of atual) for (const p of a.periodos) {
        const k = `${a.enturmacao}:${p.diarioClasse}`;
        if (esperado.has(k) && esperado.get(k) !== p.valor) divergencias.push({ turma: a.turma, nome: a.nome, periodo: p.periodo, marcado: esperado.get(k), gravado: p.valor });
      }
      for (const t of sala.turmas) await aulasDaTurma(t, true); // atualiza agenda/calendário
      return enviar(res, 200, { enviados, divergencias, alunos: atual });
    }
  }

  // Caderno de observações (um texto por turma + módulo)
  if (m && m[2] === 'observacoes') {
    if (req.method === 'GET') {
      const data = url.searchParams.get('data');
      const out = [];
      for (const t of sala.turmas) {
        const modulo = await moduloDe(t, data);
        out.push({ cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, modulo, texto: await portal.lerObservacao(t, modulo) });
      }
      return enviar(res, 200, { observacoes: out });
    }
    if (req.method === 'PUT') {
      const { cpt, data, texto = '' } = await lerJson(req);
      const t = sala.turmas.find((x) => String(x.cpt) === String(cpt));
      if (!t) return enviar(res, 400, { erro: 'Turma não pertence à sala.' });
      const salvo = await portal.salvarObservacao(t, await moduloDe(t, data), texto);
      const norm = (s) => s.replace(/\r\n/g, '\n').trim();
      return enviar(res, 200, { texto: salvo, conferido: norm(salvo) === norm(texto) });
    }
  }

  // Configuração de avaliações (conceito): indicadores + avaliações de cada turma da sala
  if (m && m[2] === 'avaliacoes' && req.method === 'GET') {
    const turmas = [];
    for (const t of sala.turmas) turmas.push({ cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, periodo: t.periodo, ...visao(await portal.lerAvaliacao(t)) });
    return enviar(res, 200, { turmas });
  }
  if (m && m[2] === 'avaliacoes' && req.method === 'POST') {
    // novas: [{ indicador, descricao, sigla }] — vão para todas as turmas da sala, uma por vez.
    // confirmar: cpts cujo "relatório de modificações" o professor já aprovou.
    const { novas = [], confirmar = [] } = await lerJson(req);
    if (!novas.length) return enviar(res, 400, { erro: 'Nenhuma avaliação nova.' });
    const feitas = [];
    for (const t of sala.turmas) {
      const r = await portal.salvarAvaliacao(t, (estado) => montar(estado, novas), confirmar.includes(t.cpt));
      if (!r.salvo) return enviar(res, 200, { pendente: { cpt: t.cpt, turma: t.turma.trim(), relatorio: r.relatorio }, feitas });
      feitas.push({ turma: t.turma.trim(), semMudanca: !!r.semMudanca });
    }
    // Conferência: relê e verifica se cada avaliação está no indicador certo
    const divergencias = [];
    const turmas = [];
    for (const t of sala.turmas) {
      const v = visao(await portal.lerAvaliacao(t));
      for (const n of novas) {
        const ind = v.indicadores.find((i) => i.chave === chaveIndicador({ descricaoReduzida: n.indicador }));
        if (!ind?.avaliacoes.some((a) => String(a.sigla).trim().toLowerCase() === String(n.sigla).trim().toLowerCase())) divergencias.push(`${t.turma.trim()}: ${n.sigla} não aparece em ${n.indicador}`);
      }
      turmas.push({ cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, periodo: t.periodo, ...v });
    }
    return enviar(res, 200, { feitas, divergencias, turmas });
  }

  // Plano de ensino: só CRIA em turmas sem plano (plano existente não pode ser alterado — aguarda aprovação)
  if (m && m[2] === 'plano' && req.method === 'GET') {
    const turmas = [];
    for (const t of sala.turmas) turmas.push({ cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, periodo: t.periodo, ...(await portal.lerPlano(t)) });
    const modelo = url.searchParams.get('modelo');
    const { modelos, campos } = await portal.modelosPlano(sala.turmas[0], modelo || null);
    // texto sugerido para "Indicadores": a lista do currículo (a mesma das avaliações)
    let indicadores = '';
    try {
      indicadores = visao(await portal.lerAvaliacao(sala.turmas[0])).indicadores.map((i, n) => `${n + 1}. ${i.descricao.replace(/\s+/g, ' ').trim()}`).join('\n');
    } catch { /* turma sem indicadores no currículo */ }
    return enviar(res, 200, { turmas, modelos, campos, indicadores });
  }
  if (m && m[2] === 'plano' && req.method === 'POST') {
    const { modelo, acao = 1, conteudos = {} } = await lerJson(req);
    if (!modelo || ![1, 2].includes(acao)) return enviar(res, 400, { erro: 'Modelo ou ação inválidos.' });
    const feitas = [];
    const puladas = [];
    for (const t of sala.turmas) {
      const r = await portal.criarPlano(t, modelo, conteudos, acao);
      (r.pulada ? puladas : feitas).push(t.turma.trim());
    }
    // Conferência: relê e compara cada campo
    const norm = (x) => String(x ?? '').replace(/\r\n/g, '\n').trim();
    const divergencias = [];
    const turmas = [];
    for (const t of sala.turmas) {
      const p = await portal.lerPlano(t);
      if (feitas.includes(t.turma.trim())) {
        if (!p.codigo) divergencias.push(`${t.turma.trim()}: plano não aparece no portal`);
        for (const [campo, texto] of Object.entries(conteudos)) {
          const c = p.campos.find((x) => String(x.campo) === String(campo));
          if (c && norm(c.conteudo) !== norm(texto)) divergencias.push(`${t.turma.trim()}: campo ${c.ordem} ${c.descricao} diferente do enviado`);
        }
      }
      turmas.push({ cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, periodo: t.periodo, ...p });
    }
    return enviar(res, 200, { feitas, puladas, divergencias, turmas });
  }

  // Digitação de notas (conceito): avaliações, indicadores e menção de cada aluno, nas turmas da sala
  if (m && m[2] === 'notas' && req.method === 'GET') {
    const turmas = [];
    for (const t of sala.turmas) turmas.push(visaoNotas(t, await portal.lerNotas(t)));
    return enviar(res, 200, { turmas });
  }
  if (m && m[2] === 'notas' && req.method === 'POST') {
    // alteracoes: [{ cpt, cod, valores: {id: conceito}, mencao }]
    const { alteracoes = [] } = await lerJson(req);
    if (!alteracoes.length) return enviar(res, 400, { erro: 'Nada para gravar.' });
    const feitas = [];
    for (const t of sala.turmas) {
      const daTurma = alteracoes.filter((a) => String(a.cpt) === String(t.cpt));
      if (!daTurma.length) continue;
      const r = await portal.salvarNotas(t, (estado) => aplicarNotas(estado, daTurma));
      feitas.push({ turma: t.turma.trim(), alunos: daTurma.length, semMudanca: !!r.semMudanca });
    }
    // Conferência: relê e compara cada valor enviado
    const divergencias = [];
    const turmas = [];
    for (const t of sala.turmas) {
      const v = visaoNotas(t, await portal.lerNotas(t));
      for (const a of alteracoes.filter((x) => String(x.cpt) === String(t.cpt))) {
        const al = v.alunos.find((x) => x.cod === String(a.cod));
        if (!al) { divergencias.push(`${v.turma}: aluno nº ? não encontrado na releitura`); continue; }
        for (const [id, val] of Object.entries(a.valores ?? {})) if ((al.valores[id] ?? '') !== val) divergencias.push(`${v.turma} · nº ${al.numero} · ${id}: marcado "${val}", gravado "${al.valores[id] ?? ''}"`);
        if (a.mencao !== undefined && al.mencao !== a.mencao) divergencias.push(`${v.turma} · nº ${al.numero} · menção: marcada "${a.mencao}", gravada "${al.mencao}"`);
      }
      turmas.push(v);
    }
    return enviar(res, 200, { feitas, divergencias, turmas });
  }

  if (m && m[2] === 'resultado' && req.method === 'POST') {
    for (const t of sala.turmas) await portal.atualizarResultado(t);
    return enviar(res, 200, { ok: true });
  }

  return enviar(res, 404, { erro: 'Rota não encontrada.' });
}

let vite;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); } catch (e) {
      if (e instanceof SessaoExpirada) { portal.logado = false; return enviar(res, 401, { erro: 'Sessão do portal expirou. Entre de novo.' }); }
      console.error(`[api] ${req.method} ${url.pathname}: ${e.message}`);
      enviar(res, 502, { erro: e.message });
    }
    return;
  }
  if (vite) return vite.middlewares(req, res);
  const arq = path.join(ROOT, 'dist', url.pathname === '/' || !path.extname(url.pathname) ? 'index.html' : path.normalize(url.pathname));
  if (!arq.startsWith(path.join(ROOT, 'dist'))) { res.writeHead(403); return res.end(); }
  try {
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': (tipos[path.extname(arq)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(await readFile(arq));
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1', () => console.log(`GV Fast em http://localhost:${PORT}`));
