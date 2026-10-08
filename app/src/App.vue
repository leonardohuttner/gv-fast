<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from './api.js';
import Login from './components/Login.vue';
import Chamada from './components/Chamada.vue';
import Turmas from './components/Turmas.vue';
import Hoje from './components/Hoje.vue';
import Dialogo from './components/Dialogo.vue';
import Avisos from './components/Avisos.vue';
import Avaliacoes from './components/Avaliacoes.vue';
import Plano from './components/Plano.vue';
import Notas from './components/Notas.vue';

const logado = ref(null);
const tela = ref('hoje');      // hoje | turma | turmas
const aba = ref('chamada');    // dentro da turma: chamada | avaliacoes | notas | plano
const dataAbrir = ref(null);
const salas = ref([]);
const salaId = ref(null);
const verEncerradas = ref(false);
const erro = ref('');

const sala = computed(() => salas.value.find((s) => s.id === salaId.value));
const GRUPOS = [
  ['andamento', 'Em andamento'],
  ['futura', 'Começam em breve'],
  ['sem-aulas', 'Sem datas no portal'],
  ['encerrada', 'Encerradas'],
];
// Encerradas/sem datas só aparecem se pedir (ou se for a sala aberta agora)
const visiveis = (estado) => salas.value.filter((s) => s.situacao?.estado === estado
  && (verEncerradas.value || ['andamento', 'futura'].includes(estado) || s.id === salaId.value));
const nEscondidas = computed(() => salas.value.filter((s) => ['encerrada', 'sem-aulas'].includes(s.situacao?.estado)).length);
const br = (d) => d ? d.split('-').reverse().slice(0, 2).join('/') : '';
const rotulo = (s) => {
  const turmas = s.turmas.length > 1 ? s.turmas.map((t) => t.turma.trim()).join(' + ') : `${s.turmas[0].turma.trim()} · ${s.turmas[0].periodo}`;
  const quando = s.situacao?.estado === 'futura' ? ` — começa ${br(s.situacao.inicio)}` : s.situacao?.pendentes ? ` — ${s.situacao.pendentes} pendente(s)` : '';
  return `${s.nome} (${turmas})${quando}`;
};

function escolherSala(ev) {
  const v = ev.target.value;
  if (v === '__encerradas') {
    verEncerradas.value = !verEncerradas.value;
    ev.target.value = salaId.value;
    return;
  }
  salaId.value = v;
  dataAbrir.value = null;
}

async function carregarSalas() {
  salas.value = await api.salas();
  if (!salas.value.some((s) => s.id === salaId.value)) salaId.value = salas.value[0]?.id ?? null;
}

async function entrou() {
  logado.value = true;
  erro.value = '';
  try { await carregarSalas(); } catch (e) { erro.value = e.message; }
}

async function sair() {
  await api.logout();
  logado.value = false;
}

async function abrir(id, data = null) {
  if (!salas.value.some((s) => s.id === id)) await carregarSalas();
  salaId.value = id;
  dataAbrir.value = data;
  aba.value = 'chamada';
  tela.value = 'turma';
}

onMounted(async () => {
  const { logado: ok } = await api.sessao();
  if (ok) await entrou(); else logado.value = false;
});
</script>

<template>
  <Dialogo />
  <Avisos />
  <Login v-if="logado === false" @entrou="entrou" />
  <div v-else-if="logado" class="app">
    <header class="topo">
      <strong>GV Fast</strong>
      <nav>
        <button :class="{ ativo: tela === 'hoje' }" @click="tela = 'hoje'">Hoje</button>
        <button :class="{ ativo: tela === 'turma' }" @click="tela = 'turma'">Turma</button>
        <button :class="{ ativo: tela === 'turmas' }" @click="tela = 'turmas'">Todas as turmas</button>
      </nav>
      <select v-if="tela === 'turma'" :value="salaId" @change="escolherSala">
        <template v-for="[estado, titulo] in GRUPOS" :key="estado">
          <optgroup v-if="visiveis(estado).length" :label="titulo">
            <option v-for="s in visiveis(estado)" :key="s.id" :value="s.id">{{ rotulo(s) }}</option>
          </optgroup>
        </template>
        <option v-if="nEscondidas" value="__encerradas">{{ verEncerradas ? '— Esconder encerradas' : `— Mostrar encerradas (${nEscondidas})…` }}</option>
      </select>
      <span v-else class="esp" />
      <button @click="sair">Sair</button>
    </header>
    <div v-if="erro" class="msg err">{{ erro }}</div>

    <Hoje v-if="tela === 'hoje'" @abrir="abrir" @expirou="logado = false" />
    <Turmas v-else-if="tela === 'turmas'" @abrir="abrir" @mudou="carregarSalas" @expirou="logado = false" />
    <template v-else-if="sala">
      <div class="abas">
        <button :class="{ ativa: aba === 'chamada' }" @click="aba = 'chamada'">Chamada</button>
        <button :class="{ ativa: aba === 'avaliacoes' }" @click="aba = 'avaliacoes'">Avaliações</button>
        <button :class="{ ativa: aba === 'notas' }" @click="aba = 'notas'">Notas</button>
        <button :class="{ ativa: aba === 'plano' }" @click="aba = 'plano'">Plano de ensino</button>
        <span v-if="sala.situacao?.estado === 'encerrada'" class="sub encerrada">turma encerrada</span>
      </div>
      <Notas v-if="aba === 'notas'" :key="'nt' + sala.id" :sala="sala" @expirou="logado = false" />
      <Plano v-else-if="aba === 'plano'" :key="'pl' + sala.id" :sala="sala" @expirou="logado = false" />
      <Avaliacoes v-else-if="aba === 'avaliacoes'" :key="'av' + sala.id" :sala="sala" @expirou="logado = false" />
      <Chamada v-else :key="sala.id + (dataAbrir || '')" :sala="sala" :data-inicial="dataAbrir" @expirou="logado = false" />
    </template>
  </div>
</template>

<style scoped>
.app { max-width: 1180px; margin: 0 auto; padding: 16px; }
.topo { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
nav { display: flex; gap: 4px; }
nav button.ativo { background: var(--accent); border-color: var(--accent); color: #fff; }
.topo select { flex: 1; min-width: 200px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--fg); font: inherit; }
.esp { flex: 1; }
.abas { display: flex; gap: 2px; align-items: flex-end; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.abas button { border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0; background: transparent; color: var(--muted); padding: 8px 14px; margin-bottom: -1px; }
.abas button.ativa { background: var(--bg); border-color: var(--border); color: var(--fg); font-weight: 600; }
.encerrada { margin-left: auto; padding-bottom: 6px; }
</style>
