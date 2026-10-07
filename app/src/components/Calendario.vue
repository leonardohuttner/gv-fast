<script setup>
// Calendário que só deixa escolher os dias com aula.
import { ref, computed, watch } from 'vue';

const props = defineProps({
  aulas: { type: Array, required: true }, // [{ data: 'YYYY-MM-DD', situacao: 0|1|2, turno }]
  modelValue: { type: String, default: null },
  disabled: Boolean,
  marcas: { type: Array, default: () => [] }, // dias dados sem conteúdo registrado
});
const emit = defineEmits(['update:modelValue']);

const SITUACAO = { 0: { cls: 'pend', nome: 'Pendente' }, 1: { cls: 'ok', nome: 'Lançada' }, 2: { cls: 'canc', nome: 'Cancelada' } };
const SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

const porData = computed(() => new Map(props.aulas.map((a) => [a.data, a])));
const meses = computed(() => [...new Set(props.aulas.map((a) => a.data.slice(0, 7)))].sort());
const hoje = (() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();

const mes = ref(null);
watch(() => [props.modelValue, meses.value], () => {
  if (props.modelValue) mes.value = props.modelValue.slice(0, 7);
  else if (!mes.value || !meses.value.includes(mes.value)) mes.value = meses.value.at(-1) ?? hoje.slice(0, 7);
}, { immediate: true });

const idx = computed(() => meses.value.indexOf(mes.value));
const titulo = computed(() => {
  const [a, m] = mes.value.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
});

const dias = computed(() => {
  const [a, m] = mes.value.split('-').map(Number);
  const primeiro = (new Date(a, m - 1, 1).getDay() + 6) % 7; // segunda = 0
  const total = new Date(a, m, 0).getDate();
  const cels = Array.from({ length: primeiro }, () => null);
  for (let d = 1; d <= total; d++) {
    const data = `${mes.value}-${String(d).padStart(2, '0')}`;
    cels.push({ d, data, aula: porData.value.get(data) });
  }
  return cels;
});

const contagem = computed(() => {
  const doMes = props.aulas.filter((a) => a.data.startsWith(mes.value));
  return { pend: doMes.filter((a) => a.situacao === 0 && a.data <= hoje).length, total: doMes.length };
});
</script>

<template>
  <div class="cal" :class="{ disabled }">
    <div class="cab">
      <button @click="mes = meses[idx - 1]" :disabled="idx <= 0" aria-label="Mês anterior">‹</button>
      <div class="tit">
        <strong>{{ titulo }}</strong>
        <span class="sub">{{ contagem.total }} aula(s)<template v-if="contagem.pend"> · <b class="pendtxt">{{ contagem.pend }} pendente(s)</b></template></span>
      </div>
      <button @click="mes = meses[idx + 1]" :disabled="idx < 0 || idx >= meses.length - 1" aria-label="Próximo mês">›</button>
    </div>
    <div class="grade">
      <div v-for="s in SEMANA" :key="s" class="sem">{{ s }}</div>
      <template v-for="(c, i) in dias" :key="i">
        <div v-if="!c" />
        <button v-else-if="c.aula" class="dia" :class="[SITUACAO[c.aula.situacao].cls, { sel: c.data === modelValue, hoje: c.data === hoje, futuro: c.data > hoje, semconteudo: marcas.includes(c.data) }]"
                :disabled="disabled" :title="`${SITUACAO[c.aula.situacao].nome}${c.aula.turno ? ' · ' + c.aula.turno : ''}`"
                @click="emit('update:modelValue', c.data)">{{ c.d }}</button>
        <div v-else class="dia vazio" :class="{ hoje: c.data === hoje }">{{ c.d }}</div>
      </template>
    </div>
    <div class="leg sub">
      <span><i class="pend" />pendente</span><span><i class="ok" />lançada</span><span><i class="canc" />cancelada</span><span v-if="marcas.length"><i class="ponto" />sem conteúdo (opcional)</span>
    </div>
  </div>
</template>

<style scoped>
.cal { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; width: 280px; }
.cal.disabled { opacity: .6; }
.cab { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.cab button { width: 30px; padding: 4px 0; }
.tit { flex: 1; text-align: center; display: flex; flex-direction: column; text-transform: capitalize; }
.tit .sub { text-transform: none; }
.pendtxt { color: var(--warn); }
.grade { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.sem { font-size: 11px; color: var(--muted); text-align: center; padding: 2px 0; }
.dia { height: 32px; padding: 0; border-radius: 6px; font-size: 13px; display: grid; place-items: center; }
.dia.vazio { color: var(--muted); opacity: .45; }
.dia.pend { background: var(--warn-bg); color: var(--warn); border-color: var(--warn); font-weight: 700; }
.dia.ok { background: var(--ok-bg); color: var(--ok); border-color: transparent; }
.dia.canc { background: var(--soft); color: var(--muted); text-decoration: line-through; border-color: transparent; }
.dia.futuro.pend { background: var(--card); border-style: dashed; font-weight: 400; }
.dia.hoje { box-shadow: inset 0 -2px 0 var(--accent); }
.dia.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
.dia { position: relative; }
.dia.semconteudo::after { content: ''; position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.leg i.ponto { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); border: 0; }
.leg { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 8px; }
.leg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.leg i.pend { background: var(--warn-bg); border: 1px solid var(--warn); }
.leg i.ok { background: var(--ok-bg); border: 1px solid var(--ok); }
.leg i.canc { background: var(--soft); border: 1px solid var(--border); }
</style>
