<script setup>
// Agenda do professor: pendências, hoje, amanhã e próximos dias — de todas as turmas/anos/salas.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar } from '../dialogo.js';
import Carregando from './Carregando.vue';

const emit = defineEmits(['abrir', 'expirou']);

const itens = ref([]);
const semConteudo = ref([]); // aulas dadas sem conteúdo realizado, por sala
const hoje = ref('');
const atualizacao = ref(null);
const erro = ref('');
const carregou = ref(false);
// Sem dados ainda (primeira vez): loading de tela inteira em vez de agenda incompleta
const esperando = computed(() => !carregou.value || (atualizacao.value?.rodando && atualizacao.value?.inicial));
let timer = null;

const amanha = computed(() => { const d = new Date(hoje.value + 'T12:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
const fmt = (iso, op) => new Date(iso + 'T12:00').toLocaleDateString('pt-BR', op);

const atrasadas = computed(() => itens.value.filter((i) => i.data < hoje.value && i.situacao === 0));
const dias = computed(() => {
  const g = new Map();
  for (const i of itens.value.filter((x) => x.data >= hoje.value)) {
    if (!g.has(i.data)) g.set(i.data, []);
    g.get(i.data).push(i);
  }
  return [...g.entries()];
});
const titulo = (d) => d === hoje.value ? 'Hoje' : d === amanha.value ? 'Amanhã' : fmt(d, { weekday: 'long' });

async function carregar() {
  try {
    const r = await api.agenda();
    itens.value = r.itens;
    semConteudo.value = r.semConteudo ?? [];
    hoje.value = r.hoje;
    atualizacao.value = r.atualizacao;
    carregou.value = true;
    erro.value = '';
  } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    erro.value = e.message;
    carregou.value = true;
  }
  // enquanto o servidor busca as datas em segundo plano, recarrega
  clearTimeout(timer);
  if (atualizacao.value?.rodando) timer = setTimeout(carregar, 2500);
}

async function naoEMinha(i) {
  const desc = i.turmas.map((t) => `${t.turma} (sala ${t.sala}, ${t.periodo})`).join(' + ');
  if (!await confirmar(`${desc}\n\nEla some da agenda e da chamada. Dá para mostrar de novo na tela Turmas.`, { titulo: `Ocultar "${i.nome}"?`, ok: 'Ocultar' })) return;
  try {
    await api.ocultarTurmas(i.turmas.map((t) => t.cpt));
    itens.value = itens.value.filter((x) => !x.turmas.some((t) => i.turmas.some((o) => o.cpt === t.cpt)));
  } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    erro.value = e.message;
  }
}

onMounted(carregar);
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <section class="hoje">
    <Carregando v-if="esperando && !erro"
      :texto="atualizacao?.etapa === 'aulas' ? 'Buscando as datas de aula de cada turma…' : 'Buscando suas turmas…'"
      :feitas="atualizacao?.feitas" :total="atualizacao?.etapa === 'aulas' ? atualizacao.total : null"
      detalhe="Na primeira vez demora (o portal abre uma turma por vez). Depois fica guardado e abre na hora." />
    <template v-else>
    <div v-if="atualizacao?.rodando" class="progresso">
      <span>Atualizando datas em segundo plano… {{ atualizacao.feitas }}/{{ atualizacao.total || '?' }} — a lista pode mudar</span>
      <div class="barra"><div :style="{ width: (atualizacao.total ? (100 * atualizacao.feitas / atualizacao.total) : 5) + '%' }" /></div>
    </div>
    <div v-if="erro" class="msg err">{{ erro }}</div>

    <div v-if="atrasadas.length" class="bloco atrasado">
      <h2>Chamadas atrasadas <span class="n">{{ atrasadas.length }}</span></h2>
      <div v-for="i in atrasadas" :key="i.data + i.salaId" class="item">
        <button class="abrir" @click="emit('abrir', i.salaId, i.data)">
          <span class="quando">{{ fmt(i.data, { day: '2-digit', month: '2-digit' }) }}</span>
          <span class="oque">{{ i.nome }}<small>{{ i.turmas.map((t) => `${t.turma} · sala ${t.sala}`).join(' + ') }}</small></span>
          <span v-if="i.turmas.length > 1" class="chip div">Sala dividida</span>
          <span class="chip pend">Pendente</span>
        </button>
        <button class="ocultar" title="Não é minha (ex.: substituição) — ocultar" @click="naoEMinha(i)">Não é minha</button>
      </div>
    </div>

    <div v-if="semConteudo.length" class="bloco conteudo">
      <h2>Aulas sem conteúdo registrado <span class="n">{{ semConteudo.reduce((s, x) => s + x.datas.length, 0) }}</span></h2>
      <div v-for="x in semConteudo" :key="x.salaId" class="item">
        <button class="abrir" @click="emit('abrir', x.salaId, x.datas[0])">
          <span class="quando">{{ x.datas.length }}<small>aula{{ x.datas.length === 1 ? '' : 's' }}</small></span>
          <span class="oque">{{ x.nome }}<small>{{ x.turmas.join(' + ') }} · {{ x.datas.slice(0, 6).map((d) => fmt(d, { day: '2-digit', month: '2-digit' })).join(', ') }}{{ x.datas.length > 6 ? '…' : '' }}</small></span>
          <span class="chip pend">Registrar conteúdo</span>
        </button>
      </div>
    </div>

    <div v-for="[d, lista] in dias" :key="d" class="bloco" :class="{ destaque: d === hoje }">
      <h2>{{ titulo(d) }} <span class="sub">{{ fmt(d, { day: '2-digit', month: 'long' }) }}</span></h2>
      <div v-for="i in lista" :key="i.salaId" class="item">
        <button class="abrir" @click="emit('abrir', i.salaId, i.data)">
          <span class="quando">{{ i.turno || '' }}<small>{{ i.periodos }} per.</small></span>
          <span class="oque">{{ i.nome }}<small>{{ i.turmas.map((t) => `${t.turma} · sala ${t.sala} · ${t.periodo}`).join(' + ') }}</small></span>
          <span v-if="i.turmas.length > 1" class="chip div">Sala dividida</span>
          <span class="chip" :class="i.situacao === 1 ? 'ok' : d <= hoje ? 'pend' : ''">{{ i.situacao === 1 ? 'Lançada' : d <= hoje ? 'Fazer chamada' : 'Prevista' }}</span>
        </button>
        <button class="ocultar" title="Não é minha (ex.: substituição) — ocultar" @click="naoEMinha(i)">Não é minha</button>
      </div>
    </div>

    <p v-if="!itens.length && !atualizacao?.rodando" class="sub">Nenhuma aula nas próximas 3 semanas.</p>
    </template>
  </section>
</template>

<style scoped>
.hoje { max-width: 760px; margin: 0 auto; }
.progresso { margin-bottom: 12px; font-size: 12px; color: var(--muted); }
.progresso .barra { height: 4px; background: var(--soft); border-radius: 2px; margin-top: 4px; overflow: hidden; }
.progresso .barra div { height: 100%; background: var(--accent); transition: width .3s; }
.bloco { margin-bottom: 18px; }
h2 { font-size: 15px; margin: 0 0 8px; text-transform: capitalize; display: flex; gap: 8px; align-items: baseline; }
h2 .sub { text-transform: none; font-weight: 400; }
.n { background: var(--warn); color: #fff; border-radius: 10px; font-size: 11px; padding: 1px 7px; }
.item { display: flex; align-items: stretch; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); overflow: hidden; }
.item:hover { border-color: var(--accent); }
.abrir { flex: 1; min-width: 0; display: flex; gap: 12px; align-items: center; text-align: left; padding: 10px 12px; border: 0; border-radius: 0; background: transparent; }
.ocultar { border: 0; border-left: 1px solid var(--soft); border-radius: 0; background: transparent; color: var(--muted); font-size: 11px; padding: 0 10px; opacity: 0; transition: opacity .15s; }
.item:hover .ocultar, .ocultar:focus-visible { opacity: 1; }
@media (hover: none) { .ocultar { opacity: 1; } }
.destaque .item { border-left: 4px solid var(--accent); }
.atrasado .item { border-left: 4px solid var(--warn); }
.conteudo .item { border-left: 4px dashed var(--warn); }
.quando { width: 64px; font-weight: 700; font-size: 13px; display: flex; flex-direction: column; }
.oque { flex: 1; min-width: 0; display: flex; flex-direction: column; }
small { font-size: 11px; color: var(--muted); font-weight: 400; }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--soft); white-space: nowrap; }
.chip.ok { background: var(--ok-bg); color: var(--ok); }
.chip.pend { background: var(--warn-bg); color: var(--warn); font-weight: 700; }
.chip.div { background: var(--t2-bg); color: var(--t2); }
</style>
