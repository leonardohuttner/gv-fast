<script setup>
// Todas as turmas do professor (ano passado, atual e próximo), com datas de aula e vínculo em salas.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import { confirmar, perguntar } from '../dialogo.js';
import Carregando from './Carregando.vue';

const emit = defineEmits(['abrir', 'mudou', 'expirou']);

const turmas = ref([]);
const carregando = ref(false);
const msg = ref(null);
const sel = ref(new Set());
const ocultarEncerradas = ref(true);
const inativa = (t) => ['Encerrada', 'Sem aulas'].includes(estado(t).txt);
const verOcultas = ref(false);
const semResumo = computed(() => turmas.value.filter((t) => !t.resumo).length);
let vivo = true;

const hoje = (() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
const br = (d) => d ? d.split('-').reverse().slice(0, 2).join('/') : '';

function estado(t) {
  const r = t.resumo;
  if (!r) return { txt: '…', cls: '' };
  if (!r.total) return { txt: 'Sem aulas', cls: 'cinza' };
  if (r.fim < hoje && !r.pendentes) return { txt: 'Encerrada', cls: 'cinza' };
  if (r.inicio > hoje) return { txt: `Começa ${br(r.inicio)}`, cls: 'futura' };
  return { txt: 'Em andamento', cls: 'ativa' };
}

const visiveis = computed(() => turmas.value.filter((t) => (verOcultas.value || !t.oculta) && (!ocultarEncerradas.value || !inativa(t))));
const nOcultas = computed(() => turmas.value.filter((t) => t.oculta).length);
const porAno = computed(() => {
  const g = new Map();
  for (const t of visiveis.value) {
    if (!g.has(t.ano)) g.set(t.ano, []);
    g.get(t.ano).push(t);
  }
  for (const l of g.values()) l.sort((a, b) => (a.resumo?.inicio ?? '9').localeCompare(b.resumo?.inicio ?? '9') || a.disciplina.localeCompare(b.disciplina));
  return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0]));
});

// Sugestão: turmas sem sala com a mesma disciplina (ex.: turma A sala 102 + turma B sala 103)
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const sugestoes = computed(() => {
  const g = new Map();
  for (const t of turmas.value.filter((x) => !x.grupo && !x.oculta)) {
    const k = norm(t.disciplina);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(t);
  }
  return [...g.values()].filter((l) => l.length > 1 && new Set(l.map((t) => t.turma.trim())).size === l.length && l.some((t) => estado(t).txt !== 'Encerrada'));
});

async function executar(fn) {
  try { await fn(); } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    msg.value = { tipo: 'err', txt: e.message };
  }
}

const carregar = () => executar(async () => {
  carregando.value = true;
  try { turmas.value = (await api.turmas()).turmas; } finally { carregando.value = false; }
  // datas de aula: uma turma por vez (o portal só tem uma turma "aberta" por sessão)
  for (const t of turmas.value) {
    if (!vivo) return;
    if (!t.resumo) t.resumo = await api.resumo(t.cpt);
  }
});

const vincular = (lista, nome) => executar(async () => {
  const n = nome ?? await perguntar('Nome da sala:', lista[0].disciplina, { titulo: 'Vincular turmas', ok: 'Vincular' });
  if (n === null) return;
  await api.criarSala(n, lista.map((t) => t.cpt));
  sel.value = new Set();
  await recarregarGrupos();
});
const vincularTodas = () => executar(async () => {
  for (const l of sugestoes.value) await api.criarSala(l[0].disciplina, l.map((t) => t.cpt));
  await recarregarGrupos();
});
const desvincular = (grupo) => executar(async () => {
  if (!await confirmar(`As turmas voltam a aparecer separadas e o app não junta esse par de novo sozinho.`, { titulo: `Desvincular "${grupo.nome}"?`, ok: 'Desvincular', perigo: true })) return;
  await api.removerSala(grupo.id);
  await recarregarGrupos();
});
async function recarregarGrupos() {
  const novos = new Map((await api.turmas()).turmas.map((t) => [t.cpt, t.grupo]));
  turmas.value.forEach((t) => (t.grupo = novos.get(t.cpt) ?? null));
  msg.value = { tipo: 'ok', txt: 'Salas atualizadas.' };
  emit('mudou');
}

const alternarOculta = (t) => executar(async () => {
  await api.ocultarTurmas([t.cpt], !t.oculta);
  t.oculta = !t.oculta;
  emit('mudou');
});

function alternar(t) {
  const s = new Set(sel.value);
  s.has(t.cpt) ? s.delete(t.cpt) : s.add(t.cpt);
  sel.value = s;
}
const selecionadas = computed(() => turmas.value.filter((t) => sel.value.has(t.cpt)));

onMounted(carregar);
onUnmounted(() => { vivo = false; });
</script>

<template>
  <section>
    <div class="barra">
      <h2>Turmas</h2>
      <label class="sub"><input type="checkbox" :checked="!ocultarEncerradas" @change="ocultarEncerradas = !$event.target.checked"> mostrar encerradas e sem datas ({{ turmas.filter(inativa).length }})</label>
      <label v-if="nOcultas" class="sub"><input type="checkbox" v-model="verOcultas"> mostrar "não é minha" ({{ nOcultas }})</label>
      <button @click="carregar" :disabled="carregando">{{ carregando ? 'Carregando…' : 'Recarregar' }}</button>
    </div>

    <div v-if="msg" class="msg" :class="msg.tipo">{{ msg.txt }}</div>

    <Carregando v-if="carregando && !turmas.length" texto="Buscando suas turmas…" />
    <div v-else-if="semResumo" class="sub progresso">
      Buscando datas de aula… {{ turmas.length - semResumo }} de {{ turmas.length }}
      <div class="barra"><div :style="{ width: (100 * (turmas.length - semResumo) / turmas.length) + '%' }" /></div>
    </div>

    <div v-if="sugestoes.length" class="sugest">
      <div class="barra">
        <strong>Possíveis salas divididas ({{ sugestoes.length }})</strong>
        <span class="sub" style="flex:1">mesma disciplina em turmas diferentes</span>
        <button class="pri" @click="vincularTodas">Vincular todas</button>
      </div>
      <div v-for="(l, i) in sugestoes" :key="i" class="sug">
        <span>{{ l[0].disciplina }}</span>
        <span class="sub">{{ l.map((t) => `${t.turma.trim()} (sala ${t.sala}, ${t.periodo})`).join(' + ') }}</span>
        <button @click="vincular(l, l[0].disciplina)">Vincular</button>
      </div>
    </div>

    <div v-if="selecionadas.length" class="barra flutua">
      <span>{{ selecionadas.length }} selecionada(s)</span>
      <button class="pri" @click="vincular(selecionadas)" :disabled="selecionadas.length < 2">Vincular como uma sala</button>
      <button @click="sel = new Set()">Limpar</button>
    </div>

    <template v-for="[ano, lista] in porAno" :key="ano">
      <h3>{{ ano }}</h3>
      <div class="tabela">
        <table>
          <thead>
            <tr><th></th><th>Disciplina</th><th>Turma</th><th>Sala</th><th>Aulas</th><th>Situação</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="t in lista" :key="t.cpt" :class="{ oculta: t.oculta, inativa: inativa(t) }">
              <td><input type="checkbox" :checked="sel.has(t.cpt)" @change="alternar(t)" :disabled="!!t.grupo"></td>
              <td>
                {{ t.disciplina }}
                <div v-if="t.grupo" class="sub">🔗 {{ t.grupo.nome }} · <a href="#" @click.prevent="desvincular(t.grupo)">desvincular</a></div>
              </td>
              <td class="nowrap">{{ t.turma.trim() }}<div class="sub">{{ t.periodo }}</div></td>
              <td>{{ t.sala }}</td>
              <td class="nowrap sub">
                <template v-if="t.resumo?.total">{{ br(t.resumo.inicio) }} → {{ br(t.resumo.fim) }}<br>{{ t.resumo.realizadas }}/{{ t.resumo.total }} lançadas</template>
              </td>
              <td>
                <span class="chip" :class="estado(t).cls">{{ estado(t).txt }}</span>
                <div v-if="t.resumo?.pendentes" class="pend">{{ t.resumo.pendentes }} pendente(s)</div>
              </td>
              <td class="nowrap">
                <button v-if="!t.oculta" @click="emit('abrir', t.grupo ? t.grupo.id : `t-${t.cpt}`)" :disabled="t.resumo && !t.resumo.total">Chamada</button>
                <button class="link" @click="alternarOculta(t)">{{ t.oculta ? 'É minha — mostrar' : 'Não é minha' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.barra { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
h2 { font-size: 17px; margin: 0; flex: 1; }
h3 { font-size: 14px; margin: 18px 0 8px; color: var(--muted); }
.sugest { background: var(--card); border: 1px solid var(--accent); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
.sug { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-top: 1px solid var(--soft); flex-wrap: wrap; }
.sug > span:first-child { flex: 1; min-width: 200px; }
.flutua { position: sticky; top: 8px; z-index: 2; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.tabela { overflow-x: auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 7px 8px; border-bottom: 1px solid var(--soft); text-align: left; vertical-align: top; }
th { background: var(--soft); font-size: 12px; color: var(--muted); }
.nowrap { white-space: nowrap; }
tr.oculta td, tr.inativa td { opacity: .45; }
button.link { border: 0; background: transparent; color: var(--muted); font-size: 11px; padding: 4px 6px; }
button.link:hover { color: var(--accent); }
a { color: var(--accent); }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--soft); white-space: nowrap; }
.chip.ativa { background: var(--ok-bg); color: var(--ok); }
.chip.futura { background: var(--t1-bg); color: var(--accent); }
.chip.cinza { color: var(--muted); }
.progresso { margin-bottom: 12px; }
.progresso .barra { height: 4px; background: var(--soft); border-radius: 2px; margin-top: 4px; overflow: hidden; }
.progresso .barra div { height: 100%; background: var(--accent); transition: width .3s; }
.pend { font-size: 11px; color: var(--warn); font-weight: 700; margin-top: 3px; }
</style>
