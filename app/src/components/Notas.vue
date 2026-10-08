<script setup>
// Lançamento de notas por conceito, com as turmas da sala juntas.
// O professor marca as AVALIAÇÕES; indicador e menção são preenchidos pela regra (e podem ser trocados à mão):
//   indicador = conceito da(s) avaliação(ões) dele · menção = D só se todos os indicadores forem A, senão ND
import { ref, computed, onMounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar } from '../dialogo.js';
import Carregando from './Carregando.vue';
import { mensagem } from '../aviso.js';

const props = defineProps({ sala: { type: Object, required: true } });
const emit = defineEmits(['expirou']);

const CICLO_AVAL = ['A', 'NA', 'PA', ''];
const CICLO_MENCAO = ['D', 'ND', ''];
const COR = { A: 'a', NA: 'na', PA: 'pa', NC: 'na', D: 'a', ND: 'na', SM: 'pa' };

const turmas = ref([]);
const alunos = ref([]);
const carregando = ref(false);
const msg = mensagem();

// descrições do portal vêm com entidades HTML e espaços sobrando
const limpar = (t) => String(t ?? '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const porChave = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true });

// Colunas: indicadores (união das turmas) com suas avaliações (por sigla)
const colunas = computed(() => {
  const m = new Map();
  for (const t of turmas.value) for (const i of t.indicadores) {
    const c = m.get(i.chave) ?? { chave: i.chave, sigla: i.sigla, descricao: i.descricao, avaliacoes: [] };
    for (const a of i.avaliacoes) if (!c.avaliacoes.some((x) => x.sigla.toLowerCase() === a.sigla.toLowerCase())) c.avaliacoes.push({ sigla: a.sigla, descricao: a.descricao });
    m.set(i.chave, c);
  }
  return [...m.values()].sort((a, b) => porChave(a.chave, b.chave));
});

// id do portal para (turma do aluno, indicador, avaliação)
function idDe(aluno, chave, sigla = null) {
  const t = turmas.value.find((x) => String(x.cpt) === String(aluno.cpt));
  const ind = t?.indicadores.find((i) => i.chave === chave);
  if (!ind) return null;
  return sigla ? ind.avaliacoes.find((a) => a.sigla.toLowerCase() === sigla.toLowerCase())?.id ?? null : ind.id;
}

function conceitoIndicador(v) {
  if (!v.length || v.some((x) => !x)) return '';
  if (v.every((x) => x === v[0])) return v[0];
  if (v.some((x) => x === 'NA' || x === 'NC')) return 'NA';
  return 'PA';
}

function recalcular(a) {
  for (const c of colunas.value) {
    const idInd = idDe(a, c.chave);
    if (!idInd || a.manualInd[c.chave]) continue;
    const vals = c.avaliacoes.map((av) => idDe(a, c.chave, av.sigla)).filter(Boolean).map((id) => a.valores[id]);
    if (vals.length) a.valores[idInd] = conceitoIndicador(vals);
  }
  if (!a.manualMencao) {
    const inds = colunas.value.map((c) => idDe(a, c.chave)).filter(Boolean).map((id) => a.valores[id]);
    a.mencao = inds.length && inds.every((x) => x) ? (inds.every((x) => x === 'A') ? 'D' : 'ND') : '';
  }
}

function receber(lista) {
  turmas.value = lista;
  alunos.value = lista.flatMap((t) => t.alunos).map((a) => ({ ...a, valores: { ...a.valores }, original: { ...a.valores }, mencaoOriginal: a.mencao, manualInd: {}, manualMencao: false }))
    .sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt-BR'));
}

const travado = (a, id) => !a.editavel || !id || a.dispensas.includes(id);
const proximo = (ciclo, v) => ciclo[(ciclo.indexOf(v) + 1) % ciclo.length] ?? ciclo[0];

function clicarAval(a, chave, sigla) {
  const id = idDe(a, chave, sigla);
  if (travado(a, id)) return;
  a.valores[id] = proximo(CICLO_AVAL, a.valores[id]);
  recalcular(a);
}
function clicarIndicador(a, chave) {
  const id = idDe(a, chave);
  if (travado(a, id)) return;
  a.valores[id] = proximo(CICLO_AVAL, a.valores[id]);
  a.manualInd[chave] = true;
  recalcular(a);
}
function clicarMencao(a) {
  if (!a.editavel) return;
  a.mencao = proximo(CICLO_MENCAO, a.mencao);
  a.manualMencao = true;
}
function todosA(chave, sigla) {
  for (const a of alunos.value) {
    const id = idDe(a, chave, sigla);
    if (travado(a, id)) continue;
    a.valores[id] = 'A';
    recalcular(a);
  }
}
const desfazer = () => alunos.value.forEach((a) => { a.valores = { ...a.original }; a.mencao = a.mencaoOriginal; a.manualInd = {}; a.manualMencao = false; });

const alterados = computed(() => alunos.value.filter((a) => a.editavel && (a.mencao !== a.mencaoOriginal || Object.keys(a.valores).some((k) => a.valores[k] !== a.original[k]))));
const mudou = (a, id) => id && a.valores[id] !== a.original[id];

async function executar(fn) {
  carregando.value = true;
  try { await fn(); } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  } finally { carregando.value = false; }
}

const carregar = () => executar(async () => {
  msg.value = null;
  receber((await api.notas(props.sala.id)).turmas);
});

const salvar = async () => {
  const porTurma = turmas.value.map((t) => `• ${t.turma} (sala ${t.sala}): ${alterados.value.filter((a) => String(a.cpt) === String(t.cpt)).length} aluno(s)`).join('\n');
  if (!await confirmar(`${porTurma}\n\nÉ registro oficial. Depois do envio o portal recalcula os resultados e as turmas são relidas para conferência.`, { titulo: 'Gravar notas no portal?', ok: 'Gravar no portal' })) return;
  await executar(async () => {
    const alteracoes = alterados.value.map((a) => ({
      cpt: a.cpt, cod: a.cod,
      valores: Object.fromEntries(Object.keys(a.valores).filter((k) => a.valores[k] !== a.original[k]).map((k) => [k, a.valores[k]])),
      ...(a.mencao !== a.mencaoOriginal ? { mencao: a.mencao } : {}),
    }));
    const r = await api.salvarNotas(props.sala.id, alteracoes);
    receber(r.turmas);
    msg.value = r.divergencias.length
      ? { tipo: 'err', txt: `⚠ Conferência encontrou diferenças:\n${r.divergencias.join('\n')}` }
      : { tipo: 'ok', txt: `✔ Gravado e conferido. ${r.feitas.map((f) => `${f.turma}: ${f.alunos} aluno(s)`).join(' · ')}` };
  });
};

onMounted(carregar);
</script>

<template>
  <section class="notas">
    <div class="barra">
      <div class="titulo">
        <h2>Notas</h2>
        <div class="sub">Marque as avaliações; indicador e menção se preenchem pela regra (clique neles para trocar à mão).</div>
      </div>
      <button @click="carregar" :disabled="carregando">Recarregar</button>
    </div>

    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>
    <Carregando v-if="carregando && !alunos.length" texto="Abrindo a digitação de notas…" :detalhe="sala.turmas.length > 1 ? 'Uma turma por vez' : ''" />

    <div v-else-if="turmas.length && !colunas.some((c) => c.avaliacoes.length)" class="msg">
      Ainda não há avaliações configuradas. Crie primeiro na aba <b>Avaliações</b>.
    </div>

    <template v-else-if="alunos.length">
      <div class="barra">
        <button @click="desfazer" :disabled="carregando || !alterados.length">Desfazer</button>
        <span class="sub dica">Clique: A → NA → PA → vazio · menção: D → ND → vazio</span>
        <button class="pri" @click="salvar" :disabled="carregando || !alterados.length">Salvar ({{ alterados.length }})</button>
      </div>
      <div class="tabela">
        <table>
          <thead>
            <tr>
              <th rowspan="2" class="aluno">Aluno</th>
              <th rowspan="2">Sala</th>
              <th v-for="c in colunas" :key="c.chave" :colspan="c.avaliacoes.length + 1" class="c grupo" :title="c.descricao">{{ c.sigla }}</th>
              <th rowspan="2" class="c">Menção</th>
            </tr>
            <tr>
              <template v-for="c in colunas" :key="c.chave">
                <th v-for="av in c.avaliacoes" :key="av.sigla" class="c" :title="av.descricao">
                  {{ av.sigla }}<br><button class="todos" @click="todosA(c.chave, av.sigla)" :disabled="carregando" title="Marcar A para todos">todos A</button>
                </th>
                <th class="c ind" :title="c.descricao">{{ c.sigla }}</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in alunos" :key="a.cpt + '-' + a.cod" :class="{ inativo: !a.editavel }">
              <td class="aluno">{{ a.nome }}<div v-if="!a.editavel" class="sit">{{ a.situacao }}</div></td>
              <td><span class="tag" :class="String(a.cpt) === String(sala.turmas[1]?.cpt) ? 't2' : 't1'">{{ a.sala }}</span></td>
              <template v-for="c in colunas" :key="c.chave">
                <td v-for="av in c.avaliacoes" :key="av.sigla" class="c">
                  <button v-if="idDe(a, c.chave, av.sigla)" class="mk" :class="[COR[a.valores[idDe(a, c.chave, av.sigla)]], { mud: mudou(a, idDe(a, c.chave, av.sigla)) }]"
                          :disabled="carregando || travado(a, idDe(a, c.chave, av.sigla))" @click="clicarAval(a, c.chave, av.sigla)">
                    {{ a.valores[idDe(a, c.chave, av.sigla)] || '–' }}
                  </button>
                </td>
                <td class="c ind">
                  <button v-if="idDe(a, c.chave)" class="mk fino" :class="[COR[a.valores[idDe(a, c.chave)]], { mud: mudou(a, idDe(a, c.chave)), manual: a.manualInd[c.chave] }]"
                          :disabled="carregando || travado(a, idDe(a, c.chave))" @click="clicarIndicador(a, c.chave)" :title="a.manualInd[c.chave] ? 'Definido à mão' : 'Pela regra'">
                    {{ a.valores[idDe(a, c.chave)] || '–' }}
                  </button>
                </td>
              </template>
              <td class="c">
                <button class="mk" :class="[COR[a.mencao], { mud: a.mencao !== a.mencaoOriginal, manual: a.manualMencao }]" :disabled="carregando || !a.editavel" @click="clicarMencao(a)">{{ a.mencao || '–' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="legenda">
        <h3>Indicadores</h3>
        <dl>
          <template v-for="c in colunas" :key="c.chave">
            <dt>{{ c.sigla }}</dt>
            <dd>
              {{ limpar(c.descricao) || '—' }}
              <span v-if="c.avaliacoes.length" class="sub avs">Avaliações: {{ c.avaliacoes.map((av) => av.descricao && av.descricao.toLowerCase() !== av.sigla.toLowerCase() ? `${av.sigla} (${limpar(av.descricao)})` : av.sigla).join(', ') }}</span>
            </dd>
          </template>
        </dl>
        <p class="sub conceitos">
          <span><b class="mk mini a">A</b> Atendido</span><span><b class="mk mini pa">PA</b> Parcialmente atendido</span><span><b class="mk mini na">NA</b> Não atendido</span>
          <span><b class="mk mini a">D</b> Desenvolvida</span><span><b class="mk mini na">ND</b> Não desenvolvida</span>
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.barra { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.titulo { flex: 1; min-width: 220px; }
h2 { font-size: 17px; margin: 0 0 4px; }
.dica { flex: 1; }
.tabela { overflow-x: auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
table { border-collapse: collapse; min-width: 100%; }
th, td { padding: 5px 6px; border-bottom: 1px solid var(--soft); text-align: left; white-space: nowrap; }
th { background: var(--soft); font-size: 12px; color: var(--muted); }
th.grupo { border-left: 2px solid var(--border); color: var(--fg); }
.c { text-align: center; }
.ind { border-right: 2px solid var(--border); background: color-mix(in srgb, var(--soft) 50%, transparent); }
.aluno { position: sticky; left: 0; background: var(--card); z-index: 1; white-space: normal; min-width: 180px; }
thead .aluno { background: var(--soft); }
.todos { font-size: 10px; padding: 1px 5px; margin-top: 2px; }
.tag { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 10px; }
.tag.t1 { background: var(--t1-bg); color: var(--accent); }
.tag.t2 { background: var(--t2-bg); color: var(--t2); }
.mk { width: 40px; height: 30px; padding: 0; font-weight: 700; }
.mk.fino { width: 36px; opacity: .9; }
.mk.a { background: var(--ok-bg); color: var(--ok); }
.mk.na { background: var(--err-bg); color: var(--err); }
.mk.pa { background: var(--warn-bg); color: var(--warn); }
.mk.mud { outline: 2px solid var(--accent); outline-offset: 1px; }
.mk.manual { box-shadow: inset 0 -3px 0 var(--accent); }
tr.inativo td { background: color-mix(in srgb, var(--warn-bg) 60%, transparent); color: var(--muted); }
tr.inativo .mk { opacity: .45; pointer-events: none; }
.sit { font-size: 11px; color: var(--warn); }
.legenda { margin-top: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
.legenda h3 { font-size: 13px; margin: 0 0 8px; color: var(--muted); font-weight: 600; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; margin: 0; font-size: 13px; line-height: 1.45; }
dt { font-weight: 700; }
dd { margin: 0; }
.avs { display: block; font-size: 12px; }
.conceitos { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 0; padding-top: 8px; border-top: 1px solid var(--soft); }
.mk.mini { display: inline-grid; place-items: center; width: auto; min-width: 28px; height: 20px; padding: 0 4px; border-radius: 5px; font-size: 11px; margin-right: 4px; }
</style>
