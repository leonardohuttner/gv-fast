// Avisos flutuantes (canto da tela): o resultado de cada gravação aparece mesmo se a mensagem da tela estiver fora de vista.
import { reactive, ref, watch } from 'vue';

export const avisos = reactive([]);
let seq = 0;

export function avisar({ tipo = 'ok', txt }) {
  const id = ++seq;
  avisos.push({ id, tipo, txt });
  if (tipo === 'ok') setTimeout(() => fecharAviso(id), 6000); // erro/diferença fica até fechar
}
export function fecharAviso(id) {
  const i = avisos.findIndex((a) => a.id === id);
  if (i >= 0) avisos.splice(i, 1);
}

// Mensagem da tela que também vira aviso flutuante quando é sucesso ou erro
export function mensagem() {
  const m = ref(null);
  watch(m, (v) => { if (v?.txt && (v.tipo === 'ok' || v.tipo === 'err')) avisar(v); });
  return m;
}
