<script setup>
defineProps({
  texto: { type: String, default: 'Carregando…' },
  detalhe: { type: String, default: '' },
  feitas: { type: Number, default: null },
  total: { type: Number, default: null },
});
</script>

<template>
  <div class="carregando" role="status" aria-live="polite">
    <div class="roda" />
    <strong>{{ texto }}</strong>
    <template v-if="total">
      <div class="barra"><div :style="{ width: (100 * (feitas || 0) / total) + '%' }" /></div>
      <span class="sub">{{ feitas || 0 }} de {{ total }}</span>
    </template>
    <span v-if="detalhe" class="sub">{{ detalhe }}</span>
  </div>
</template>

<style scoped>
.carregando { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center; }
.roda { width: 32px; height: 32px; border: 3px solid var(--soft); border-top-color: var(--accent); border-radius: 50%; animation: gira .8s linear infinite; }
.barra { width: min(320px, 100%); height: 6px; background: var(--soft); border-radius: 3px; overflow: hidden; }
.barra div { height: 100%; background: var(--accent); transition: width .3s; }
@keyframes gira { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .roda { animation-duration: 3s; } }
</style>
