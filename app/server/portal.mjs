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

// Texto da programação vindo do HTML (Base64 de UTF-8, quebras como <br>)
function textoProgramacao(b64) {
  let s;
  try { s = Buffer.from(b64, 'base64').toString('utf8'); } catch { s = ''; }
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/\r\n/g, '\n').trim();
}

// O portal grava em ISO-8859-1 via escape(): troca o que não existe em Latin-1 por equivalentes simples
export function paraLatin1(s) {
  return String(s ?? '').replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/\u2022/g, '-').replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\r\n/g, '\n').replace(/[^\x00-\xFF]/g, '?');
}

// Form urlencoded; listas viram campos repetidos (ex.: idsparciais[]=a&idsparciais[]=b), como o ExtJS faz
function codificarForm(form) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    if (Array.isArray(v)) v.forEach((x) => u.append(k, x));
    else if (v !== undefined) u.append(k, v ?? '');
  }
  return u;
}

// Árvore de campos do plano → lista plana { campo (código do modelo), codigo, ordem, descricao, tipo, conteudo }
function achatar(nos = []) {
  return nos.flatMap((n) => [
    { campo: n.campo ?? n.codigo, codigo: n.codigo, ordem: n.ordem, descricao: n.descricao, tipo: n.tipo, conteudo: n.conteudo ?? '' },
    ...achatar(n.filhos),
  ]);
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

  // corpoCru: corpo já montado (string), enviado sem recodificar — usado onde o portal monta "nome=valor&" na mão
  async #req(url, { method = 'GET', form, corpoCru, ajax = false, referer } = {}) {
    const headers = { 'User-Agent': UA, Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    // navegação de página: mesmos cabeçalhos de um navegador (o portal decide o formato da resposta pela "cara" do pedido)
    if (!ajax && method === 'GET') Object.assign(headers, { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' });
    const multipart = form instanceof FormData;
    if ((form && !multipart) || corpoCru != null) headers['Content-Type'] = corpoCru != null ? 'application/x-www-form-urlencoded' : 'application/x-www-form-urlencoded; charset=UTF-8';
    if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
    if (method === 'POST') headers.Origin = ORIGEM;
    if (referer) headers.Referer = referer;
    const res = await fetch(url, { method, headers, body: corpoCru != null ? Buffer.from(corpoCru, 'latin1') : multipart ? form : form ? codificarForm(form) : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const utf8 = /utf-8/i.test(res.headers.get('content-type') || '');
    const text = buf.toString(utf8 ? 'utf8' : 'latin1');
    // sessão expirada: o portal devolve a página de login com 200 (sem redirecionar)
    if (!/login\.php5/.test(url) && /<title>\s*Login\s*-\s*APSWEB/i.test(text)) {
      this.logado = false;
      throw new SessaoExpirada();
    }
    return { status: res.status, location: res.headers.get('location'), text };
  }

  // Chamada leve e autenticada para a sessão do portal não expirar por inatividade
  manterSessao() {
    return this.serial(async () => {
      const r = await this.#req(ORIGEM + '/modulos/app/app.php/Configuracoes?ViewConfiguracoesJson%5Bmethod%5D=loadConfiguracoes', { ajax: true, referer: BASE + 'index.php5' });
      if (r.location && /login/.test(r.location)) { this.logado = false; throw new SessaoExpirada(); }
    });
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
    let idx;
    try { idx = await this.#req(BASE + 'index.php5'); } catch (e) {
      if (e instanceof SessaoExpirada) throw new Error('Portal não aceitou a sessão.');
      throw e;
    }
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
    const carga = Number((d.text.match(/DiarioClasse\.cargaHorariaBase\s*=\s*'?(\d+)/) || [])[1]) || null;
    return { url, aulas: lerAulas(d.text), cargaHoraria: carga, usuario: (d.text.match(/DiarioClasse\.codigoUsuario\s*=\s*'(\d+)'/) || [])[1] };
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

  // ---------- Plano de ensino (planoensino.php5) ----------
  async #plano(metodo, form = {}) {
    const r = await this.#req(BASE + 'planoensino.php5', { method: 'POST', ajax: true, referer: BASE + 'planoensino.php5', form: { 'ViewPlanoEnsinoXmlXsl[method]': metodo, asJSON: 'true', ...form } });
    if (r.location && /login/.test(r.location)) throw new SessaoExpirada();
    let j;
    try { j = JSON.parse(r.text); } catch { throw new Error(`${metodo}: ${(r.text.match(/<mensagem>([^<]*)/) || [])[1] || 'resposta inesperada'}`); }
    if (j.success === false) throw new Error(`${metodo}: ${j.errormsg || 'falhou'}`);
    return j.data;
  }

  // Abre a tela do plano da turma (confere a turma) e devolve o que a página embute
  async #abrirPlano(t) {
    await this.abrirTurma(t); // confere codigoProfessorTurma e reabre a "página da turma"
    // O portal às vezes devolve, no GET da página, o JSON da última chamada AJAX do plano.
    // Tenta alguns caminhos (todos funcionam num navegador) até vir a página de verdade.
    const urlTurma = `${BASE}turmas.php5?anos=${encodeURIComponent(enc(t.ano))}&semestre=-2&curso=-2&codigoProfessorTurma=${encodeURIComponent(enc(t.cpt))}`;
    const tentativas = [
      () => this.#req(BASE + 'planoensino.php5', { referer: urlTurma }),
      async () => { await this.#req(urlTurma); return this.#req(BASE + 'planoensino.php5?asJSON=false', { referer: urlTurma }); },
      async () => { await this.#req(urlTurma); return this.#req(BASE + 'planoensino.php5?ViewPlanoEnsinoXmlXsl%5Bmethod%5D=', { referer: urlTurma }); },
    ];
    let pag;
    const vistos = [];
    for (const tentar of tentativas) {
      pag = await tentar();
      // redirecionamento: segue (só dentro do portal, nunca para o login)
      for (let i = 0; pag.location && i < 3; i++) {
        const destino = new URL(pag.location, BASE + 'planoensino.php5');
        if (destino.origin !== ORIGEM || /login/.test(destino.pathname)) throw new SessaoExpirada();
        pag = await this.#req(destino.href, { referer: urlTurma });
      }
      if (/PlanoEnsino\.codigo\s*=/.test(pag.text)) break;
      vistos.push(/^\s*\{/.test(pag.text) ? `JSON(${Object.keys((() => { try { return JSON.parse(pag.text); } catch { return {}; } })()).join(',')}; ${(pag.text.match(/"descricao":"([^"]{0,40})/) || [])[1] || ''})` : `${pag.status}/${pag.text.length}b`);
    }
    if (vistos.length) console.error(`[plano] respostas fora do esperado antes da página: ${vistos.join(' | ')}`);
    const v = (k) => (pag.text.match(new RegExp(`PlanoEnsino\\.${k}\\s*=\\s*'?([^';]*)'?;`)) || [])[1];
    if (v('codigo') === undefined) {
      const tipo = pag.location ? `redirecionou para ${pag.location.replace(/\?.*$/, '')}` : /^\s*\{/.test(pag.text) ? 'veio JSON' : /<erro>/.test(pag.text) ? `erro do portal: ${(pag.text.match(/<mensagem>([^<]*)/) || [])[1]}` : `HTML sem dados do plano (${pag.text.length} bytes)`;
      throw new Error(`Tela do plano de ensino não abriu como esperado (HTTP ${pag.status}, ${tipo}; tentativas: ${vistos.join(' | ')}). Nada foi enviado.`);
    }
    return { codigo: v('codigo') || null, situacao: Number(v('situacao') || 0), aprovacaoCoord: v('aprovacaoPlanoPeloCoord') === 'true', acessoCoordenador: v('acessoCoordenador') === 'true' };
  }

  // Plano da turma: situação + campos preenchidos (se existir)
  lerPlano(t) {
    return this.serial(async () => {
      const p = await this.#abrirPlano(t);
      const campos = p.codigo ? achatar(await this.#plano('getTreeCamposPlano', { codigoPlanoEnsino: p.codigo })) : [];
      return { ...p, campos };
    });
  }

  // Modelos disponíveis + campos de um modelo (precisa de uma turma aberta na sessão)
  modelosPlano(t, codigoModelo) {
    return this.serial(async () => {
      await this.#abrirPlano(t);
      const modelos = (await this.#plano('getModelos')).filter((m) => m.ativo == 1).map((m) => ({ codigo: m.codigo, descricao: m.descricao }));
      const campos = codigoModelo ? achatar(await this.#plano('getTreeCamposModelo', { codigoModelo })) : [];
      return { modelos, campos };
    });
  }

  // Cria o plano (só se a turma ainda não tiver). acao: 1 = salvar (em elaboração), 2 = salvar e enviar para aprovação.
  // conteudos: { [codigoCampoDoModelo]: texto }
  criarPlano(t, codigoModelo, conteudos, acao) {
    return this.serial(async () => {
      const p = await this.#abrirPlano(t);
      if (p.codigo) return { pulada: true, situacao: p.situacao };
      const campos = achatar(await this.#plano('getTreeCamposModelo', { codigoModelo }));
      const form = { modelo: String(codigoModelo), codigo: '' };
      for (const c of campos) {
        form[`campos[${c.campo}][campo]`] = String(c.campo);
        form[`campos[${c.campo}][ordem]`] = c.ordem;
        if (c.tipo === 'U') {
          const texto = String(conteudos[c.campo] ?? '').trim();
          if (!texto) throw new Error(`Campo "${c.ordem} ${c.descricao}" está vazio. Nada foi enviado.`);
          form[`campos[${c.campo}][conteudo]`] = texto;
        }
      }
      const situacao = acao === 2 ? (p.aprovacaoCoord ? 2 : 4) : 1;
      await this.#plano('savePlanoEnsino', { ...form, situacao: String(situacao), acessoCoordenador: String(p.acessoCoordenador), updateClicked: 'false', acaoSalvar: String(acao) });
      return { pulada: false };
    });
  }

  // ---------- Digitação de notas (digitarnotas.php5) ----------
  // Chamadas de carga levam form_key = sha1(urlEncode(valores na ordem)) — createExtAjaxFormKey do portal
  async #notasPost(params, comChave = true) {
    const form = comChave ? { ...params, form_key: formKey(...Object.values(params)) } : params;
    const r = await this.#req(BASE + 'digitarnotas.php5', { method: 'POST', ajax: true, form, referer: BASE + 'digitarnotas.php5' });
    if (r.location && /login/.test(r.location)) throw new SessaoExpirada();
    let j;
    try { j = JSON.parse(r.text); } catch { throw new Error(`${params['ViewDigitarNotasXmlXsl[method]']}: ${(r.text.match(/<mensagem>([^<]*)/) || [])[1] || 'resposta inesperada'}`); }
    if (j && j.success === false) throw new Error(`${params['ViewDigitarNotasXmlXsl[method]']}: ${j.errormsg || j.data?.message || 'falhou'}`);
    return j;
  }

  // Abre a digitação da turma: página → etapas (getNextStep) → parâmetros → estrutura → notas
  async #abrirNotas(t) {
    const { url: urlDiario } = await this.abrirTurma(t);
    const pag = await this.#req(BASE + 'digitarnotas.php5', { referer: urlDiario });
    const modulo = (pag.text.match(/DigitarNotas\.emEdicao\s*=\s*'([^']*)'/) || [])[1];
    const controle = (pag.text.match(/DigitarNotas\.controleDigitacao\s*=\s*'([^']*)'/) || [])[1];
    if (!modulo || !controle) throw new Error('Tela de digitação de notas não abriu como esperado. Nada foi enviado.');
    const M = 'ViewDigitarNotasXmlXsl[method]';
    let step = 'e00';
    for (let i = 0; step && i < 30; i++) {
      const r = await this.#notasPost({ [M]: 'getNextStep', step, controleDigitacao: controle, modulo });
      step = r.data?.proximaEtapa?.id ?? null;
    }
    const info = await this.#notasPost({ [M]: 'getInfoDigitacao', modulo });
    if (String(info.codigoProfessorTurma) !== String(t.cpt)) throw new Error(`Digitação abriu outra turma/disciplina em vez de ${t.turma}. Nada foi enviado.`);
    const estrutura = await this.#notasPost({ [M]: 'getAvaliacoesModulo', controleDigitacao: controle, modulo });
    const n = await this.#req(`${BASE}digitarnotas.php5?ViewDigitarNotasXmlXsl[method]=getNotasTurma&modulo=${modulo}&codigoEmpresa=null&codigoUnidade=null`, { ajax: true });
    let rows;
    try { rows = JSON.parse(n.text).rows ?? []; } catch { throw new Error('getNotasTurma: resposta inesperada'); }
    return { modulo, controle, info, estrutura, rows };
  }

  lerNotas(t) {
    return this.serial(() => this.#abrirNotas(t));
  }

  // aplicar(estado) → { rows alterados } ; grava todos os alunos (como a tela do portal) e pede o cálculo
  salvarNotas(t, aplicar) {
    return this.serial(async () => {
      const e = await this.#abrirNotas(t);
      const rows = aplicar(e);
      if (!rows) return { semMudanca: true };
      const m = e.modulo;
      const enviar = (e.estrutura.parciais ?? []).flatMap((p) => [p.idParcial, ...(p.subParciais ?? []).map((s) => s.idParcial)]);
      const ALUNOS = rows.map((aluno) => {
        const nodo = {
          NOTAMODULO: { CODIGOAVALIACAOITEM: aluno['CDN_' + m], VALORAVALIACAO: aluno['NM_' + m], CODIGODISPENSA: aluno['DM_' + m] },
          FALTAMODULO: { CODIGOAVALIACAOITEM: aluno['CDF_' + m], VALORAVALIACAO: aluno['FM_' + m], CODIGODISPENSA: aluno['DM_' + m] },
          PREVENTIVA: { CODIGOAVALIACAOITEM: aluno['CDR_' + m], VALORAVALIACAO: aluno['RP_' + m], CODIGODISPENSA: aluno['DM_' + m], NAOCOMPARECEU: aluno['RP_' + m + '_NC'] },
          MEDIAMODULO: { CODIGOAVALIACAOITEM: aluno['CDM_' + m], CODIGODISPENSA: aluno['DM_' + m] },
          PARCIAIS: [],
        };
        // dispensa do indicador vale para as avaliações dele (mesma regra da tela)
        let pai = null;
        let paiDisp = null;
        for (const p of enviar) {
          const [raiz, resto] = String(p).split('_');
          if (pai !== raiz) { pai = null; paiDisp = null; }
          if (!resto) { pai = p; paiDisp = aluno['D_' + p]; }
          if (pai === raiz && paiDisp != '1') aluno['D_' + p] = paiDisp;
          nodo.PARCIAIS.push({ CODIGOAVALIACAOITEM: aluno['CD_' + p], VALORAVALIACAO: aluno[p], CODIGODISPENSA: aluno['D_' + p], IDPARCIAL: p });
        }
        return nodo;
      });
      const r = await this.#notasPost({
        'ViewDigitarNotasXmlXsl[method]': 'salvarNotas', modulo: m, codigoControleDigitacao: e.controle,
        aulasDadas: parseInt(e.info.aulasDadas, 10), decimais: e.info.numeroDecimais, formaAvaliacao: e.info.formaAvaliacao,
        notas: JSON.stringify({ ALUNOS }), 'idsparciais[]': enviar, gvroute: await this.#gvroute(),
      }, false);
      await this.#notasPost({ 'ViewDigitarNotasXmlXsl[method]': 'calcularNotas' }, false);
      return { salvo: true, resposta: r?.success };
    });
  }

  // constante "gvroute" que a tela manda no salvarNotas (lida do JS do portal)
  async #gvroute() {
    if (!this._gvroute) {
      const js = await this.#req(BASE + 'presenters/DigitarNotas/DigitarNotas.js');
      this._gvroute = (js.text.match(/gvroute'\s*:\s*'(\w+)'/) || [])[1];
      if (!this._gvroute) throw new Error('Não encontrei o gvroute no JS do portal. Nada foi enviado.');
    }
    return this._gvroute;
  }

  // ---------- Programação de aulas (programacao.php5) ----------
  // Lê os dias: { data, ymd, codigo, modulo, programado, realizado, editaProgramado, editaRealizado }
  async #abrirProgramacao(t) {
    const { url: urlDiario } = await this.abrirTurma(t); // confere codigoProfessorTurma
    const pag = await this.#req(BASE + 'programacao.php5', { referer: urlDiario });
    const cpt = (pag.text.match(/CopiarPrograma\.init\((\d+)\)/) || [])[1];
    if (cpt && cpt !== String(t.cpt)) throw new Error(`Programação abriu outra turma/disciplina em vez de ${t.turma}. Nada foi enviado.`);
    const dias = [...pag.text.matchAll(/PagePrincipal\.addText\(\s*'[^']*',\s*'(\d{8})',\s*'(\d+)',\s*'([^']*)',\s*'([^']*)',\s*Base64\.decode\('([^']*)'\),\s*Base64\.decode\('([^']*)'\),\s*'(\d)',\s*'(\d)'\)/g)]
      .map((m) => ({
        ymd: m[1], data: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, codigo: m[2], dataHora: m[3], modulo: m[4],
        programado: textoProgramacao(m[5]), realizado: textoProgramacao(m[6]), editaProgramado: m[7] === '1', editaRealizado: m[8] === '1',
      }));
    if (!dias.length && !/PagePrincipal/.test(pag.text)) throw new Error('Tela de programação não abriu como esperado. Nada foi enviado.');
    return dias;
  }

  lerProgramacao(t) {
    return this.serial(() => this.#abrirProgramacao(t));
  }

  // itens: [{ data: 'AAAA-MM-DD', tipo: 'programa' | 'realizado', texto }]
  // Monta o corpo igual ao oAjax do portal: "nome=valor&" sem codificar, valor = urlEncode(texto + ' ') (Latin-1)
  salvarProgramacao(t, itens) {
    return this.serial(async () => {
      const dias = await this.#abrirProgramacao(t);
      const partes = [['ViewProgramacaoAjax[method]', 'ajax_autoSavePrograma'], ['debugReqId', `gvfast-${Date.now()}`]];
      let chave = '';
      for (const it of itens) {
        const d = dias.find((x) => x.data === it.data);
        if (!d) throw new Error(`${t.turma}: não há aula em ${it.data} na programação. Nada foi enviado.`);
        const pode = it.tipo === 'programa' ? d.editaProgramado : d.editaRealizado;
        if (!pode) throw new Error(`${t.turma}: o portal não permite editar o ${it.tipo === 'programa' ? 'programado' : 'realizado'} de ${it.data}. Nada foi enviado.`);
        const campo = (it.tipo === 'programa' ? 'p' : 'r') + d.ymd;
        const valor = paraLatin1(it.texto) + ' '; // o portal acrescenta um espaço (evita "\" no fim)
        const nome = `textProgramaAula[${campo}]`;
        partes.push([`${nome}[campo]`, campo], [`${nome}[valor]`, urlEncode(valor)], [`${nome}[codigo]`, d.codigo], [`${nome}[data]`, d.dataHora], [`${nome}[modulo]`, d.modulo], [`${nome}[tipo]`, it.tipo]);
        chave += campo + valor + d.codigo + d.dataHora + d.modulo + it.tipo;
      }
      partes.push(['empresa', 'null'], ['unidade', 'null'], ['form_key', formKey('ajax_autoSavePrograma' + chave)]);
      const corpoCru = partes.map(([k, v]) => `${k}=${v}&`).join('');
      const r = await this.#req(BASE + 'programacao.php5?useAjaxView=1', { method: 'POST', corpoCru, ajax: true, referer: BASE + 'programacao.php5' });
      const erro = Number((r.text.match(/<errorcode>(\d+)<\/errorcode>/) || [])[1] ?? -1);
      const msg = (r.text.match(/<par>([^<]*)<\/par>/) || r.text.match(/<errormsg>([^<]*)<\/errormsg>/) || [])[1] || '';
      if (erro !== 0) throw new Error(`Programação: ${msg || 'o portal recusou o envio'}`);
      return { mensagem: msg };
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
  // Dias letivos + carga horária da disciplina (da página do diário)
  aulas(t) {
    return this.serial(async () => {
      const { aulas, cargaHoraria } = await this.abrirTurma(t);
      return { aulas, cargaHoraria };
    });
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
