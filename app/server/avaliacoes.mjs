// Configuração de avaliações por conceito:
//   parcial (raiz)  = indicador do currículo (I1, I2…)
//   subparcial      = avaliação criada pelo professor (Trabalho 1 / tb1…), filha de um indicador
// Formatos iguais aos de getDados()/getParciais() da tela do portal (Ext.gvux.ConfigAvaliacao).

// Chave do indicador: 'I 4' / 'I4' / 'i4' → 'I4'
export const chaveIndicador = (p) => String(p.descricaoReduzida ?? p.descricaoreduzida ?? p.id ?? '').replace(/\s+/g, '').toUpperCase();
const porNumero = (a, b) => a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true });

// Estado do portal → visão para o app
export function visao(estado) {
  const raiz = estado.parciais.filter((p) => p.codigoParcialPai == null);
  const configurada = raiz.length > 0;
  const base = configurada
    ? raiz.map((p) => ({ chave: chaveIndicador(p), sigla: p.descricaoReduzida, descricao: p.descricao, codigoParcial: p.codigoParcial }))
    : estado.indicadores.map((i) => ({ chave: chaveIndicador(i), sigla: i.descricaoreduzida, descricao: i.descricao, codigoParcial: null }));
  return {
    configurada,
    modulo: estado.modulo,
    formaCalculo: estado.dados?.formaCalculo ?? null,
    tipoTurma: estado.tipoTurma,
    indicadores: base.sort(porNumero).map((b) => ({
      chave: b.chave, sigla: b.sigla, descricao: String(b.descricao || '').trim(),
      avaliacoes: configurada
        ? estado.parciais.filter((p) => p.codigoParcialPai === b.codigoParcial).sort((x, y) => x.ordem - y.ordem)
          .map((p) => ({ descricao: p.descricao, sigla: p.descricaoReduzida, codigoParcial: p.codigoParcial }))
        : [],
    })),
  };
}

// Monta { dados, parciais } para ajax_salvaDados a partir do estado atual + avaliações novas.
// novas: [{ indicador: 'I1', descricao, sigla }]. Avaliação com sigla já existente no indicador é pulada (idempotente).
// Retorna { parciais: null } se não há nada a gravar.
export function montar(estado, novas) {
  let menor = Math.min(0, ...estado.parciais.map((p) => Number(p.codigoParcial) || 0));
  const proximo = () => --menor; // códigos temporários negativos, como a tela do portal

  let lista;
  if (estado.parciais.length) {
    lista = estado.parciais.map((p) => ({
      codigoParcial: p.codigoParcial, codigoParcialPai: p.codigoParcialPai ?? null, idParcial: p.idParcial,
      idFormula: p.idFormula, arquivoFormula: p.arquivoFormula, descricao: p.descricao, descricaoReduzida: p.descricaoReduzida,
      modoCalculoSubparciais: p.modoCalculoSubparciais, ordem: p.ordem, peso: p.peso ?? '', parcialBonus: p.parcialBonus ? 1 : 0,
    }));
  } else {
    // primeira configuração: importa os indicadores do currículo (como a tela faz ao escolher "Conceito")
    lista = estado.indicadores.map((i) => ({ chave: chaveIndicador(i), i })).sort(porNumero).map(({ i }, n) => ({
      codigoParcial: proximo(), codigoParcialPai: null, idParcial: i.id, descricao: i.descricao, descricaoReduzida: i.descricaoreduzida,
      peso: i.peso ?? '', modoCalculoSubparciais: 5, ordem: n + 1, parcialBonus: 0,
    }));
  }

  let novasAdicionadas = 0;
  for (const n of novas) {
    const pai = lista.find((p) => p.codigoParcialPai == null && chaveIndicador(p) === String(n.indicador).replace(/\s+/g, '').toUpperCase());
    if (!pai) throw new Error(`Indicador ${n.indicador} não existe nesta turma.`);
    const filhos = lista.filter((p) => p.codigoParcialPai === pai.codigoParcial);
    const sigla = String(n.sigla || '').trim();
    const descricao = String(n.descricao || '').trim();
    if (!sigla || !descricao) throw new Error('Toda avaliação precisa de descrição e descrição reduzida.');
    if (sigla.length > 10) throw new Error(`Descrição reduzida "${sigla}" passa de 10 caracteres.`);
    if (descricao.length > 600) throw new Error(`Descrição de "${sigla}" passa de 600 caracteres.`);
    if (filhos.some((f) => String(f.descricaoReduzida).trim().toLowerCase() === sigla.toLowerCase())) continue;
    const c = proximo();
    lista.push({ codigoParcial: c, codigoParcialPai: pai.codigoParcial, idParcial: c, descricao, descricaoReduzida: sigla, modoCalculoSubparciais: ' ', ordem: filhos.length + 1, peso: '', parcialBonus: 0 });
    novasAdicionadas++;
  }
  if (!novasAdicionadas) return { parciais: null };

  // regra do portal (base curricular + subparciais): todo indicador precisa de ao menos uma avaliação
  const sem = lista.filter((p) => p.codigoParcialPai == null && !lista.some((f) => f.codigoParcialPai === p.codigoParcial));
  if (sem.length) throw new Error(`Cada indicador precisa de pelo menos uma avaliação. Faltando em: ${sem.map((p) => p.descricaoReduzida).join(', ')}.`);

  const formaCalculo = String(estado.dados?.formaCalculo ?? (estado.tipoTurma === 'C' ? 5 : ''));
  if (!formaCalculo) throw new Error('Tipo de avaliação não definido para esta turma; configure pelo portal.');
  const dados = {
    arquivoFormula: estado.dados?.arquivoformula ?? '', codigoModelo: '', formaCalculo,
    idFormula: estado.dados?.idFormula ?? '', moduloAtual: String(estado.modulo), vlrNotaMaxima: estado.dados?.vlrNotaMaxima ?? 10,
  };
  return { dados, parciais: lista };
}
