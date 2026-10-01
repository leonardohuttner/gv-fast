<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar } from '../dialogo.js';
import Calendario from './Calendario.vue';
import Caderno from './Caderno.vue';
import Carregando from './Carregando.vue';

const props = defineProps({ sala: { type: Object, required: true }, dataInicial: { type: String, default: null } });
const emit = defineEmits(['expirou']);

const MARCA = {
  1: { txt: '•', cls: 'p', nome: 'Presença' },
  2: { txt: 'F', cls: 'f', nome: 'Falta' },
  3: { txt: 'FJ', cls: 'fj', nome: 'Falta justificada' },
  4: { txt: 'AT', cls: 'at', nome: 'Atraso' },
};

const hoje = (() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
const aulas = ref([]);
const data = ref(null);
const alunos = ref([]);
const carregando = ref(false);
const msg = ref(null);

const periodos = computed(() => [...new Set(alunos.value.flatMap((a) => a.periodos.map((p) => p.periodo)))].sort((x, y) => x - y));
// Só alunos cursando entram na chamada; desistentes/evadidos/etc. ficam visíveis mas travados
const ativo = (a) => a.pode && /CURSANDO/i.test(a.situacaoAluno || '');
const alterados = computed(() => alunos.value.filter((a) => ativo(a) && a.periodos.some((p) => p.valor !== p.original)));
const semMarcacao = computed(() => alunos.value.filter((a) => ativo(a) && a.periodos.some((p) => p.valor == null)));
const cel = (a, n) => a.periodos.find((p) => p.periodo === n);
const corTurma = (cpt) => (String(cpt) === String(props.sala.turmas[1]?.cpt) ? 't2' : 't1');
const dia = computed(() => aulas.value.find((a) => a.data === data.value));
const pendente = computed(() => dia.value?.situacao === 0);
const dataBr = computed(() => data.value?.split('-').reverse().join('/') ?? '');

// Aula não realizada: o portal mostra "–" e ignora o que estiver guardado no banco (sobras/padrões).
// Regra dele: se o DIA está não realizado, todos os períodos ficam "–" (mesmo que um período venha marcado).
// Fazemos igual: começa vazio e o professor marca.
function receber(lista) {
  const diaPendente = dia.value?.situacao === 0;
  alunos.value = lista.map((a) => ({
    ...a,
    periodos: a.periodos.map((p) => {
      const valor = diaPendente || String(p.situacao) === '0' ? null : p.valor;
      return { ...p, valor, original: valor };
    }),
  }));
}

async function executar(fn) {
  carregando.value = true;
  try { await fn(); } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  } finally { carregando.value = false; }
}

// Dia inicial: a pendência mais antiga até hoje; senão a última aula até hoje; senão a primeira.
function diaInicial(lista) {
  const passadas = lista.filter((a) => a.data <= hoje && a.situacao !== 2);
  return (passadas.find((a) => a.situacao === 0) ?? passadas.at(-1) ?? lista[0])?.data ?? null;
}

const carregarAulas = async () => {
  aulas.value = (await api.aulas(props.sala.id)).aulas;
};

async function trocarDia(d) {
  if (d === data.value) return;
  if (alterados.value.length && !await confirmar('Há marcações não salvas neste dia. Trocar de dia e descartar?', { ok: 'Descartar e trocar', perigo: true })) return;
  data.value = d;
  carregar();
}

const carregar = () => executar(async () => {
  if (!data.value) return;
  msg.value = null;
  alunos.value = [];
  const { alunos: lista } = await api.chamada(props.sala.id, data.value);
  receber(lista);
  if (!lista.some((a) => a.periodos.length)) msg.value = { tipo: '', txt: `Sem aula cadastrada em ${dataBr.value}.` };
});

const girar = (a, p) => { if (ativo(a)) p.valor = p.valor == null ? 1 : (p.valor % 4) + 1; };
const definirLinha = (a, v) => { if (ativo(a)) a.periodos.forEach((p) => (p.valor = v)); };
const todosPresentes = () => alunos.value.forEach((a) => definirLinha(a, 1));
const desfazer = () => alunos.value.forEach((a) => a.periodos.forEach((p) => (p.valor = p.original)));

const salvar = async () => {
  if (semMarcacao.value.length) { msg.value = { tipo: 'err', txt: `Faltam marcações para ${semMarcacao.value.length} aluno(s). Preencha todos antes de salvar.` }; return; }
  const porTurma = props.sala.turmas
    .map((t) => `• ${t.turma} (sala ${t.sala}): ${alterados.value.filter((a) => String(a.cpt) === String(t.cpt)).length} aluno(s)`)
    .join('\n');
  if (!await confirmar(`${porTurma}\n\nÉ registro oficial. Depois do envio as turmas são relidas para conferência.`, { titulo: `Gravar a frequência de ${dataBr.value}?`, ok: 'Gravar no portal' })) return;
  return executar(async () => {
    msg.value = null;
    const r = await api.salvarChamada(props.sala.id, data.value, alterados.value);
    await carregarAulas(); // antes de receber: o dia agora consta como realizado
    receber(r.alunos);
    const enviados = r.enviados.map((e) => `${e.turma}: ${e.alunos} aluno(s)`).join('\n');
    msg.value = r.divergencias.length
      ? { tipo: 'err', txt: `⚠ Conferência encontrou diferenças:\n${r.divergencias.map((d) => `${d.turma} · ${d.nome} · P${d.periodo}: marcado ${MARCA[d.marcado]?.txt}, gravado ${MARCA[d.gravado]?.txt ?? 'vazio'}`).join('\n')}` }
      : { tipo: 'ok', txt: `✔ Gravado e conferido.\n${enviados}` };
  });
};

const atualizarResultado = async () => {
  if (alterados.value.length && !await confirmar('Há marcações não salvas. Atualizar o resultado mesmo assim? Elas continuam na tela.', { ok: 'Atualizar' })) return;
  return executar(async () => {
    await api.atualizarResultado(props.sala.id);
    const marcadas = alunos.value;
    const { alunos: lista } = await api.chamada(props.sala.id, data.value);
    // mantém marcações não salvas; atualiza % e faltas
    const porChave = new Map(marcadas.map((a) => [a.cpt + '-' + a.enturmacao, a]));
    receber(lista);
    for (const a of alunos.value) {
      const antes = porChave.get(a.cpt + '-' + a.enturmacao);
      if (antes) a.periodos.forEach((p, i) => { if (antes.periodos[i]) p.valor = antes.periodos[i].valor; });
    }
    msg.value = { tipo: 'ok', txt: '✔ Resultado atualizado (frequência e faltas).' };
  });
};

onMounted(() => executar(async () => {
  await carregarAulas();
  data.value = aulas.value.some((a) => a.data === props.dataInicial) ? props.dataInicial : diaInicial(aulas.value);
  if (!data.value) msg.value = { tipo: '', txt: 'Nenhuma aula cadastrada para essa sala.' };
}).then(carregar));
</script>

<template>
  <section>
    <div class="barra">
      <div class="titulo">
        <h2>Chamada</h2>
        <div class="sub">
          <span v-for="t in sala.turmas" :key="t.cpt" class="tag" :class="corTurma(t.cpt)">{{ t.turma }} · sala {{ t.sala }}</span>
        </div>
      </div>
      <button @click="atualizarResultado" :disabled="carregando || !data" title="Recalcula frequência e faltas no portal">Atualizar resultado</button>
      <button @click="carregar" :disabled="carregando || !data">{{ carregando ? 'Carregando…' : 'Recarregar' }}</button>
    </div>

    <div class="layout">
    <div class="lateral">
      <Calendario :aulas="aulas" :model-value="data" :disabled="carregando" @update:model-value="trocarDia" />
      <Caderno :sala="sala" :data="data" :alunos="alunos" @expirou="emit('expirou')" />
    </div>
    <div class="conteudo">
    <h3 v-if="data" class="dia">{{ new Date(data + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) }}</h3>

    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>

    <Carregando v-if="carregando && !alunos.length" :texto="aulas.length ? 'Carregando alunos…' : 'Carregando dias de aula…'"
      :detalhe="sala.turmas.length > 1 ? `Abrindo ${sala.turmas.length} turmas no portal, uma por vez` : ''" />

    <template v-if="alunos.length && periodos.length">
      <div v-if="pendente && !alterados.length" class="aviso">
        <span><strong>Aula ainda não realizada.</strong> Marque as presenças; ao salvar ela fica como realizada no portal.</span>
        <button class="pri" @click="todosPresentes" :disabled="carregando">Aula realizada — todos presentes</button>
      </div>
      <div class="barra">
        <button @click="todosPresentes" :disabled="carregando">Todos presentes</button>
        <button @click="desfazer" :disabled="carregando || !alterados.length">Desfazer</button>
        <span class="sub dica">Clique para trocar: • → F → FJ → AT</span>
        <span v-if="semMarcacao.length && alterados.length" class="falta">{{ semMarcacao.length }} sem marcação</span>
        <button class="pri" @click="salvar" :disabled="carregando || !alterados.length || semMarcacao.length > 0">Salvar ({{ alterados.length }})</button>
      </div>
      <div class="tabela">
        <table>
          <thead>
            <tr>
              <th>Aluno</th><th>Sala</th>
              <th v-for="n in periodos" :key="n" class="c" :title="`${n}ª hora/período`">{{ n }}ª h</th>
              <th class="c">Todos</th><th class="c">%</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in alunos" :key="a.cpt + '-' + a.enturmacao" :class="{ inativo: !ativo(a) }">
              <td>{{ a.nome }}<div v-if="!ativo(a)" class="sit">{{ a.situacaoAluno }}</div></td>
              <td><span class="tag" :class="corTurma(a.cpt)">{{ a.sala }}</span></td>
              <td v-for="n in periodos" :key="n" class="c">
                <button v-if="cel(a, n)" class="mk" :class="[MARCA[cel(a, n).valor]?.cls, { mud: cel(a, n).valor !== cel(a, n).original }]"
                        :disabled="!ativo(a) || carregando" :title="MARCA[cel(a, n).valor]?.nome || 'Sem marcação'" @click="girar(a, cel(a, n))">
                  {{ MARCA[cel(a, n).valor]?.txt ?? '–' }}
                </button>
              </td>
              <td class="c nowrap">
                <template v-if="ativo(a)">
                  <button @click="definirLinha(a, 1)" :disabled="carregando" title="Presente em todos">•</button>
                  <button @click="definirLinha(a, 2)" :disabled="carregando" title="Falta em todos">F</button>
                </template>
              </td>
              <td class="c sub">{{ a.percentual != null ? a.percentual.toFixed(0) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    </div>
    </div>
  </section>
</template>

<style scoped>
.barra { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.titulo { flex: 1; min-width: 200px; }
.layout { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.lateral { width: 300px; display: flex; flex-direction: column; gap: 12px; }
.lateral :deep(.cal) { width: 100%; }
.conteudo { flex: 1; min-width: 0; }
h3.dia { font-size: 15px; margin: 0 0 8px; text-transform: capitalize; }
@media (max-width: 720px) { .lateral { width: 100%; } }
h2 { font-size: 17px; margin: 0 0 4px; }
.dica { flex: 1; }
.tag { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 10px; margin-right: 4px; white-space: nowrap; }
.tag.t1 { background: var(--t1-bg); color: var(--accent); }
.tag.t2 { background: var(--t2-bg); color: var(--t2); }
.tabela { overflow-x: auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--soft); text-align: left; }
th { background: var(--soft); font-size: 12px; color: var(--muted); }
.c { text-align: center; }
.nowrap { white-space: nowrap; }
tr.inativo td { background: color-mix(in srgb, var(--warn-bg) 60%, transparent); color: var(--muted); }
tr.inativo .mk { opacity: .45; pointer-events: none; }
.sit { font-size: 11px; color: var(--warn); }
.aviso { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; background: var(--warn-bg); border: 1px solid var(--warn); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.falta { color: var(--warn); font-weight: 700; font-size: 12px; }
.mk { width: 40px; height: 32px; padding: 0; font-weight: 700; }
.mk.p { background: var(--ok-bg); color: var(--ok); }
.mk.f { background: var(--err-bg); color: var(--err); }
.mk.fj { background: var(--warn-bg); color: var(--warn); }
.mk.at { background: var(--late-bg); color: var(--late); }
.mk.mud { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
