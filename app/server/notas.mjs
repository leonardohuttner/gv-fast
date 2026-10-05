// Digitação de notas por conceito: avaliações (subparciais) → indicador (parcial) → menção do módulo.
// Regras do professor (o portal não calcula nada no modo conceito sem fórmula):
//   - indicador = conceito das avaliações dele (uma só: igual; várias: todas A → A, alguma NA → NA, senão PA)
//   - menção = D se TODOS os indicadores forem A; senão ND (vazio se faltar algum indicador)

export const chaveIndicador = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

export function conceitoIndicador(valores) {
  const v = valores.map((x) => String(x ?? '').trim());
  if (!v.length || v.some((x) => !x)) return '';
  if (v.every((x) => x === v[0])) return v[0];
  if (v.every((x) => x === 'A')) return 'A';
  if (v.some((x) => x === 'NA')) return 'NA';
  return 'PA';
}

export function mencao(indicadores) {
  const v = indicadores.map((x) => String(x ?? '').trim());
  if (!v.length || v.some((x) => !x)) return '';
  return v.every((x) => x === 'A') ? 'D' : 'ND';
}

// Estado do portal → visão para o app
export function visaoNotas(t, e) {
  const m = e.modulo;
  const indicadores = (e.estrutura.parciais ?? []).map((p) => ({
    id: p.idParcial, chave: chaveIndicador(p.descricaoReduzida ?? p.descRed), sigla: p.descricaoReduzida ?? p.descRed, descricao: String(p.descricao ?? '').trim(),
    avaliacoes: (p.subParciais ?? []).map((s) => ({ id: s.idParcial, sigla: s.descricaoReduzida ?? s.descRed, descricao: String(s.descricao ?? '').trim() })),
  }));
  const ids = indicadores.flatMap((i) => [i.id, ...i.avaliacoes.map((a) => a.id)]);
  const alunos = e.rows.map((r) => {
    const dispensado = (id) => r['DL_' + id] && r['DL_' + id] !== 'SD'; // SD = sem dispensa
    return {
      cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, cod: String(r.COD), nome: r.NOM, numero: r.NRO,
      situacao: r.DCS, resultado: r.RES, faltas: r['FM_' + m],
      editavel: r.EDT !== false && /ATIVO|CURSANDO/i.test(r.DCS || ''),
      valores: Object.fromEntries(ids.map((id) => [id, String(r[id] ?? '').trim()])),
      dispensas: ids.filter(dispensado),
      mencao: String(r['NM_' + m] ?? '').trim(),
    };
  });
  return {
    cpt: t.cpt, turma: t.turma.trim(), sala: t.sala, modulo: m, formaAvaliacao: e.info.formaAvaliacao,
    conceitos: { parcial: (e.info.conceitos?.parcial ?? []).filter((c) => c.trim()), modulo: (e.info.conceitos?.modulo ?? []).filter((c) => c.trim()) },
    indicadores, alunos,
  };
}

// Aplica alterações [{ cod, valores: {id: v}, mencao }] nas linhas cruas da turma. Retorna as linhas, ou null se nada mudou.
export function aplicarNotas(e, alteracoes) {
  const m = e.modulo;
  const conceitosOk = new Set(['', ...(e.info.conceitos?.parcial ?? []).map((c) => c.trim())]);
  const mencoesOk = new Set(['', ...(e.info.conceitos?.modulo ?? []).map((c) => c.trim())]);
  let mudou = false;
  const porCod = new Map(alteracoes.map((a) => [String(a.cod), a]));
  for (const r of e.rows) {
    const a = porCod.get(String(r.COD));
    if (!a) continue;
    if (r.EDT === false) throw new Error(`Aluno nº ${r.NRO} não pode ser editado no portal. Nada foi enviado.`);
    for (const [id, v] of Object.entries(a.valores ?? {})) {
      if (!(id in r)) throw new Error(`Avaliação/indicador ${id} não existe nesta turma. Nada foi enviado.`);
      if (!conceitosOk.has(v)) throw new Error(`Conceito "${v}" inválido. Nada foi enviado.`);
      if (String(r[id] ?? '').trim() !== v) { r[id] = v; mudou = true; }
    }
    if (a.mencao !== undefined) {
      if (!mencoesOk.has(a.mencao)) throw new Error(`Menção "${a.mencao}" inválida. Nada foi enviado.`);
      if (String(r['NM_' + m] ?? '').trim() !== a.mencao) { r['NM_' + m] = a.mencao; mudou = true; }
    }
  }
  return mudou ? e.rows : null;
}
