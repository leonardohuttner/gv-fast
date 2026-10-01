// Cliente do Portal Professor (APSWEB / GVdasa GV College) — Senac RS.
// Uma instância = uma sessão (cookie jar em memória). Nada de senha/cookie em disco ou log.
import { createHash } from 'node:crypto';

const ORIGEM = 'https://apsweb.senacrs.com.br';
const BASE = ORIGEM + '/modulos/professor/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DB = 'PHOENIXHA/GVDASA_GVCOLLEGE';
// Unidade de login ("empresa,unidade", ex.: "1,10") — vem do app/.env para não ficar no código
const UNIDADE = () => process.env.GV_UNIDADE || '';

export class SessaoExpirada extends Error {}

// form_key = sha1(urlEncode(valores concatenados)) — igual a hashFormulario() do lib.js
const urlEncode = (s) => escape(s)
  .replace(/\+/g, '%2B').replace(/@/g, '%40').replace(/\*/g, '%2A').replace(/\//g, '%2F')
  .replace(/%20/g, '+');
const formKey = (...valores) => createHash('sha1').update(urlEncode(valores.join('')), 'latin1').digest('hex');

// IDs ofuscados do portal: base64(bytes XOR 0xAA)
export const enc = (s) => Buffer.from([...Buffer.from(String(s), 'latin1')].map((b) => b ^ 0xaa)).toString('base64');

export const dec = (s) => Buffer.from(Buffer.from(String(s), 'base64').map((b) => b ^ 0xaa)).toString('latin1');

// Argumentos literais de uma chamada JS: 'texto', "texto" ou valores soltos.
function argsJs(s) {
  const out = [];
  const re = /\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,]*?))\s*(?:,|$)/gy;
  let m;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    const v = m[1] ?? m[2];
    out.push(v != null ? v.replace(/\\(.)/g, '$1') : m[3]);
    if (m[0] === '') break;
  }
  return out;
}

// A página do diário embute os dias letivos: DiarioClasse.aulasDiario = Ext.decode('[...]');
function lerAulas(html) {
  const m = html.match(/DiarioClasse\.aulasDiario\s*=\s*Ext\.decode\('((?:[^'\\]|\\.)*)'\)/);
  if (!m) return [];
  const json = m[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c);
  return JSON.parse(json).map((d) => {
    const periodos = Object.values(d.periodos || {}).map((p) => ({ periodo: Number(p.periodo), diarioClasse: Number(p.diarioClasse), situacao: Number(p.situacao) }));
    const ativos = periodos.filter((p) => p.situacao !== 2);
    return {
      data: d.data,
      modulo: Number(d.modulo),
      turno: d.descricaoTurno,
      situacao: ativos.length ? Math.min(...ativos.map((p) => p.situacao)) : 2,
      periodos,
    };
  });
}

export class Portal {
  jar = new Map();
  logado = false;
  #fila = Promise.resolve();

  // A turma "atual" fica na sessão do portal → operações por turma rodam em série
  serial(fn) {
    const p = this.#fila.then(fn);
    this.#fila = p.catch(() => {});
    return p;
  }

  async #req(url, { method = 'GET', form, ajax = false, referer } = {}) {
    const headers = { 'User-Agent': UA, Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    const multipart = form instanceof FormData;
    if (form && !multipart) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
    if (method === 'POST') headers.Origin = ORIGEM;
    if (referer) headers.Referer = referer;
    const res = await fetch(url, { method, headers, body: multipart ? form : form ? new URLSearchParams(form) : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const utf8 = /utf-8/i.test(res.headers.get('content-type') || '');
    return { status: res.status, location: res.headers.get('location'), text: buf.toString(utf8 ? 'utf8' : 'latin1') };
  }

  async login(cpf, senha) {
    if (!/^\d+,\d+$/.test(UNIDADE())) throw new Error('Configure GV_UNIDADE no app/.env (ex.: GV_UNIDADE=1,10).');
    this.jar.clear();
    this.logado = false;
    await this.#req(BASE + 'login.php5');

    // MudaBase(): carrega unidades da base (registra a base na sessão)
    const u = await this.#req(BASE + 'login.php5?view=ajax', {
      method: 'POST', ajax: true, referer: BASE + 'login.php5',
      form: { form_key: formKey('loadUnidades', DB), 'ViewLoginAjax[method]': 'loadUnidades', base: DB },
    });
    if (!u.text.includes('<errorcode>0</errorcode>')) throw new Error('Portal não carregou as unidades.');

    const campos = {
      dbList: DB, lstUnidades: UNIDADE(), usr: String(cpf).replace(/\D/g, ''),
      passwd: Buffer.from(senha, 'latin1').toString('base64'),
      base: '', postBack: '1', acao: 'login', 'ViewLoginXmlXsl[method]': 'btnLogin_click',
    };
    const r = await this.#req(BASE + 'login.php5?', {
      method: 'POST', referer: BASE + 'login.php5',
      form: { ...campos, form_key: formKey(...Object.values(campos)) },
    });
    if (!r.text.includes("location.assign('index.php5')")) {
      if (/g-recaptcha|data-sitekey/i.test(r.text)) throw new Error('O portal pediu CAPTCHA. Entre pelo site oficial.');
      const alerta = (r.text.match(/alert\(['"]([^'"]{3,200})['"]\)/) || [])[1];
      throw new Error(alerta || 'Login recusado pelo portal.');
    }
    const idx = await this.#req(BASE + 'index.php5');
    if (/login\.php5/.test(idx.location || '') || idx.text.length < 2000) throw new Error('Portal não aceitou a sessão.');
    this.logado = true;
    return { nome: (idx.text.match(/class="[^"]*nomeUsuario[^"]*"[^>]*>([^<]+)/) || [])[1]?.trim() || null };
  }

  // Turmas do professor num ano (filtro da página inicial). Os dados vêm como GridIndex.addArray(...) no HTML.
  listarTurmas(ano) {
    return this.serial(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ prof: '', anos: enc(ano), semestre: '-2', curso: '-2', postBack: '1', acao: 'aplicaFiltros' })) fd.append(k, v);
      const r = await this.#req(BASE + 'index.php5', { method: 'POST', form: fd, referer: BASE + 'index.php5' });
      if ((r.location && /login/.test(r.location)) || !/GridIndex/.test(r.text)) throw new SessaoExpirada();
      return [...r.text.matchAll(/GridIndex\.addArray\(([\s\S]*?)\);/g)].map((m) => argsJs(m[1])).filter((a) => a.length >= 15).map((a) => ({
        turma: a[5].trim(), ano: a[0], periodo: a[1] === '0' ? a[0] : `${a[0]}/${a[1]}`,
        cod: dec(a[2]), cpt: dec(a[8]), curso: a[3], ciclo: a[4], unidade: a[6], disciplina: a[7], sala: a[10],
      }));
    });
  }

  // Abre a "página da turma" (define a turma na sessão) e confirma qual turma o portal abriu.
  async abrirTurma(t) {
    const pag = await this.#req(`${BASE}turmas.php5?anos=${encodeURIComponent(enc(t.ano))}&semestre=-2&curso=-2&codigoProfessorTurma=${encodeURIComponent(enc(t.cpt))}`);
    if (pag.location && /login/.test(pag.location)) throw new SessaoExpirada();
    const url = `${BASE}diarioClasse.php5?turma=${encodeURIComponent(enc(t.cod))}`;
    const d = await this.#req(url);
    if (d.location && /login/.test(d.location)) throw new SessaoExpirada();
    // Conferência: o portal guarda a turma na sessão; o código da turma sozinho não é único (uma turma pode ter várias disciplinas)
    const cptAberta = (d.text.match(/DiarioClasse\.codigoProfessorTurma\s*=\s*'(\d+)'/) || [])[1];
    if (cptAberta !== String(t.cpt)) {
      const aberta = (d.text.match(/Turma:\s*([^\s<&]+)/) || [])[1];
      throw new Error(`Portal abriu outra turma/disciplina (${aberta || '?'}) em vez de ${t.turma}. Nada foi enviado.`);
    }
    return { url, aulas: lerAulas(d.text), usuario: (d.text.match(/DiarioClasse\.codigoUsuario\s*=\s*'(\d+)'/) || [])[1] };
  }

  // Observação ("caderno") do professor: um texto por turma + módulo (não é por dia)
  lerObservacao(t, modulo) {
    return this.serial(async () => {
      const { url, usuario } = await this.abrirTurma(t);
      const j = await this.diario(url, 'getObservacaoDiarioClasse', { numeroModulo: modulo, codigoUsuario: usuario });
      return j.data?.observacao ?? '';
    });
  }

  salvarObservacao(t, modulo, texto) {
    return this.serial(async () => {
      const { url, usuario } = await this.abrirTurma(t);
      await this.diario(url, 'salvarObservacaoDiarioClasse', { observacao: texto, numeroModulo: modulo, codigoUsuario: usuario });
      const j = await this.diario(url, 'getObservacaoDiarioClasse', { numeroModulo: modulo, codigoUsuario: usuario });
      return j.data?.observacao ?? '';
    });
  }

  // ---------- Configuração de avaliações (configuraravaliacoes.php5) ----------
  async #avaliacao(metodo, form = {}, url = 'configuraravaliacoes.php5?ViewEditarParciaisXmlXsl[method]=', method = 'POST') {
    const r = await this.#req(BASE + url + metodo, { method, ajax: true, form: method === 'POST' ? form : undefined, referer: BASE + 'configuraravaliacoes.php5' });
    if (r.location && /login/.test(r.location)) throw new SessaoExpirada();
    let j;
    try { j = JSON.parse(r.text); } catch { throw new Error(`${metodo}: ${(r.text.match(/<mensagem>([^<]*)/) || [])[1] || 'resposta inesperada'}`); }
    if (!j.success) throw new Error(`${metodo}: ${j.errormsg || 'falhou'}`);
    return j.data;
  }

  // Abre a tela de avaliações da turma (confere a turma) e lê tudo: módulos, dados, parciais e indicadores do currículo
  async #abrirAvaliacao(t, modulo) {
    await this.abrirTurma(t); // confere codigoProfessorTurma
    const pag = await this.#req(BASE + 'configuraravaliacoes.php5');
    const desc = (pag.text.match(/Page\.descricaoTurma\s*=\s*'([^']*)'/) || [])[1] || '';
    if (!desc.includes(t.turma.trim())) throw new Error(`Tela de avaliações abriu outra turma (${desc || '?'}) em vez de ${t.turma}. Nada foi enviado.`);
    const modulos = (await this.#avaliacao('ajax_loadModulos')).rows ?? [];
    const mod = String(modulo ?? modulos[0]?.codigo ?? 1);
    return {
      tipoTurma: (pag.text.match(/Page\.tipoAvaliacaoTurma\s*=\s*'([^']*)'/) || [])[1] || '',
      modulos, modulo: mod,
      dados: await this.#avaliacao('ajax_loadDadosAvaliacao', { moduloAtual: mod }),
      parciais: (await this.#avaliacao('ajax_loadParciais', { moduloAtual: mod })).rows ?? [],
      indicadores: (await this.#avaliacao('ajax_loadParciaisIndicadores', {}, 'editarparciais.php5?ViewEditarParciaisXmlXsl[method]=', 'GET')).rows?.parciais ?? [],
    };
  }

  lerAvaliacao(t, modulo) {
    return this.serial(() => this.#abrirAvaliacao(t, modulo));
  }

  // Grava a configuração (dados + lista plana de parciais/subparciais) na turma. Retorna { salvo, relatorio }.
  salvarAvaliacao(t, montar, confirma = false) {
    return this.serial(async () => {
      const atual = await this.#abrirAvaliacao(t);
      const { dados, parciais } = montar(atual); // monta em cima do estado atual (idempotente)
      if (!parciais) return { salvo: true, semMudanca: true };
      const r = await this.#avaliacao('ajax_salvaDados', {
        moduloAtual: atual.modulo, dados: JSON.stringify(dados), parciais: JSON.stringify(parciais), confirma: confirma ? 1 : 0,
      });
      return { salvo: !!r?.salvo, relatorio: r?.relatorio ?? null };
    });
  }

  // "Atualizar resultado" do diário: recalcula frequência/faltas da turma
  atualizarResultado(t) {
    return this.serial(async () => {
      const { url } = await this.abrirTurma(t);
      await this.diario(url, 'atualizaResultado', {});
    });
  }

  // Dias letivos da turma: [{ data, modulo, situacao: 0 não realizada | 1 realizada | 2 cancelada, periodos }]
  aulas(t) {
    return this.serial(async () => (await this.abrirTurma(t)).aulas);
  }

  async diario(url, metodo, params) {
    const r = await this.#req(url, { method: 'POST', ajax: true, referer: url, form: { 'ViewDiarioClasseXmlXsl[method]': metodo, ...params } });
    if (r.location && /login/.test(r.location)) throw new SessaoExpirada();
    let j;
    try { j = JSON.parse(r.text); } catch {
      if (/login\.php5/.test(r.text) && r.text.length < 3000) throw new SessaoExpirada();
      throw new Error(`${metodo}: ${(r.text.match(/<mensagem>([^<]*)/) || [])[1] || 'resposta inesperada'}`);
    }
    if (!j.success) throw new Error(`${metodo}: ${j.errormsg || 'falhou'}`);
    return j;
  }

  // Alunos + frequência do dia. Turma sem aula nessa data → [].
  lerChamada(t, data) {
    return this.serial(async () => {
      const { url, aulas } = await this.abrirTurma(t);
      const dia = aulas.find((a) => a.data === data);
      if (!dia) return [];
      const j = await this.diario(url, 'loadAlunosAulaDiario', { data, modulo: dia.modulo, codigoEmpresaPolo: '', codigoUnidadePolo: '' });
      return j.data || [];
    });
  }

  // alunos: [{ enturmacao, editAfast, periodos: [{ diarioClasse, diarioClasseAluno, enturmacaoVinculo, justificativaFalta, turmaHorariosEad, situacao, valor }] }]
  salvarChamada(t, data, alunos) {
    return this.serial(async () => {
      const { url, aulas } = await this.abrirTurma(t);
      const dia = aulas.find((a) => a.data === data);
      if (!dia) throw new Error(`${t.turma} não tem aula em ${data}. Nada foi enviado.`);
      const modulo = dia.modulo;
      const naoRealizadas = alunos.flatMap((a) => a.periodos).filter((p) => String(p.situacao) !== '1');
      const periodos = [...new Map(naoRealizadas.map((p) => [p.diarioClasse, { diarioClasse: p.diarioClasse, situacao: 1 }])).values()];
      const indicadores = alunos.flatMap((a) => a.periodos.map((p) => ({
        enturmacao: a.enturmacao, enturmacaoVinculo: p.enturmacaoVinculo, diarioClasse: p.diarioClasse,
        diarioClasseAluno: p.diarioClasseAluno, indicadorPresenca: p.valor, justificativaFalta: p.justificativaFalta,
        turmaHorariosEad: p.turmaHorariosEad, editAfast: a.editAfast,
      })));
      await this.diario(url, 'salvaIndicadoresAula', {
        periodos: JSON.stringify(periodos), indicadores: JSON.stringify(indicadores),
        modulo, empresa: 'false', unidade: 'false',
      });
    });
  }
}
