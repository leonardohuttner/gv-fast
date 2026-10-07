<script setup>
// Dias em que o aluno teve falta, falta justificada ou atraso, hora a hora (para responder "quando eu faltei?").
import { ref, computed, onMounted } from 'vue';
import { api, NaoLogado } from '../api.js';
import Carregando from './Carregando.vue';

const props = defineProps({ sala: { type: Object, required: true }, aluno: { type: Object, required: true }, limite: { type: Number, default: null } });
const emit = defineEmits(['fechar', 'expirou']);

const MARCA = { 1: { txt: '•', cls: 'p', nome: 'Presente' }, 2: { txt: 'F', cls: 'f', nome: 'Falta' }, 3: { txt: 'FJ', cls: 'fj', nome: 'Falta justificada' }, 4: { txt: 'AT', cls: 'at', nome: 'Atraso' } };

const dias = ref([]);
const justificativas = ref([]);
const carregando = ref(true);
const erro = ref(null);

const motivo = (cod) => justificativas.value.find((j) => Number(j.codigo) === Number(cod));
const conta = (v) => dias.value.reduce((s, d) => s + d.periodos.filter((p) => p.valor === v).length, 0);
const resumo = computed(() => ({ f: conta(2), fj: conta(3), at: conta(4) }));
const fmt = (d) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
// falta só nas primeiras horas e presença depois → provavelmente chegou atrasado
const chegouDepois = (d) => {
  const v = d.periodos.map((p) => p.valor);
  const i = v.findIndex((x) => x !== 2);
  return v[0] === 2 && i > 0 && v.slice(i).every((x) => x === 1 || x === 4);
};
const saiuAntes = (d) => {
  const v = d.periodos.map((p) => p.valor);
  return v[0] === 1 && v.at(-1) === 2 && v.slice(v.indexOf(2)).every((x) => x === 2);
};
const texto = (p) => (p.valor === 3 ? motivo(p.justificativaFalta)?.legenda ?? 'FJ' : MARCA[p.valor]?.txt ?? '–');
const titulo = (p) => `${p.periodo}ª hora: ${p.valor === 3 ? `Falta justificada${motivo(p.justificativaFalta) ? ' — ' + motivo(p.justificativaFalta).descricao : ''}` : MARCA[p.valor]?.nome ?? 'sem marcação'}`;

onMounted(async () => {
  try {
    const r = await api.faltasAluno(props.sala.id, props.aluno.cpt, props.aluno.enturmacao);
    dias.value = r.dias;
    justificativas.value = r.justificativas ?? [];
  } catch (e) {
    if (e instanceof NaoLogado) return emit('expirou');
    erro.value = e.message;
  } finally {
    carregando.value = false;
  }
});
</script>

<template>
  <div class="fundo" @mousedown.self="emit('fechar')" @keydown.esc="emit('fechar')" tabindex="-1">
    <div class="caixa" role="dialog" aria-modal="true">
      <h3>Faltas de {{ aluno.nome }}</h3>
      <p class="sub">
        {{ aluno.turma }} · {{ aluno.totalFaltas ?? 0 }} h de falta no portal<template v-if="limite != null"> · limite {{ limite }} h</template>
      </p>

      <Carregando v-if="carregando" texto="Lendo as chamadas lançadas…" detalhe="Um dia por vez, na primeira consulta" />
      <div v-else-if="erro" class="msg err">{{ erro }}</div>
      <p v-else-if="!dias.length" class="sub vazio">Nenhuma falta ou atraso nas aulas lançadas.</p>
      <template v-else>
        <p class="resumo">
          <span v-if="resumo.f"><b class="mk f">F</b> {{ resumo.f }} h de falta</span>
          <span v-if="resumo.fj"><b class="mk fj">FJ</b> {{ resumo.fj }} h justificada(s)</span>
          <span v-if="resumo.at"><b class="mk at">AT</b> {{ resumo.at }} atraso(s)</span>
        </p>
        <div class="lista">
          <table>
            <thead>
              <tr><th>Data</th><th v-for="p in dias[0].periodos" :key="p.periodo" class="c">{{ p.periodo }}ª h</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="d in dias" :key="d.data">
                <td class="nowrap">{{ fmt(d.data) }}<div v-if="d.turno" class="sub">{{ d.turno }}</div></td>
                <td v-for="p in d.periodos" :key="p.periodo" class="c"><span class="mk" :class="MARCA[p.valor]?.cls" :title="titulo(p)">{{ texto(p) }}</span></td>
                <td class="sub">{{ chegouDepois(d) ? 'chegou depois' : saiuAntes(d) ? 'saiu antes' : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="sub">Só aulas já lançadas. Passe o mouse numa marcação para ver o motivo.</p>
      </template>

      <div class="botoes"><button class="pri" @click="emit('fechar')">Fechar</button></div>
    </div>
  </div>
</template>

<style scoped>
.fundo { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / .45); display: grid; place-items: center; padding: 16px; }
.caixa { display: flex; flex-direction: column; max-height: calc(100vh - 32px); width: 100%; max-width: 560px; background: var(--card); color: var(--fg); border: 1px solid var(--border); border-radius: 12px; padding: 18px; box-shadow: 0 10px 40px rgb(0 0 0 / .3); }
h3 { margin: 0 0 4px; font-size: 16px; }
.caixa > .sub { margin: 0 0 12px; }
.vazio { padding: 12px 0; }
.resumo { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 8px; font-size: 13px; }
.lista { overflow-y: auto; min-height: 0; flex: 1 1 auto; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 5px 6px; border-bottom: 1px solid var(--soft); text-align: left; }
th { position: sticky; top: 0; background: var(--card); font-weight: 600; color: var(--muted); font-size: 12px; }
.c { text-align: center; }
.nowrap { white-space: nowrap; text-transform: capitalize; }
.mk { display: inline-block; min-width: 26px; padding: 1px 5px; border-radius: 5px; font-weight: 700; font-size: 12px; text-align: center; }
.mk.p { color: var(--ok); }
.mk.f { background: var(--err-bg); color: var(--err); }
.mk.fj { background: var(--t2-bg); color: var(--t2); }
.mk.at { background: var(--warn-bg); color: var(--warn); }
.botoes { display: flex; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--soft); }
</style>
