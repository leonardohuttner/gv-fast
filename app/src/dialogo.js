// Confirmações e perguntas dentro do app (alguns navegadores embutidos bloqueiam confirm()/prompt()).
import { reactive } from 'vue';

export const dialogo = reactive({ aberto: false, titulo: '', texto: '', ok: 'OK', cancelar: 'Cancelar', perigo: false, campo: null, valor: '', resolver: null });

function abrir(opcoes) {
  return new Promise((resolver) => Object.assign(dialogo, { titulo: '', ok: 'OK', cancelar: 'Cancelar', perigo: false, campo: null, valor: '', ...opcoes, aberto: true, resolver }));
}

// → true/false
export const confirmar = (texto, opcoes = {}) => abrir({ texto, ...opcoes });

// → texto digitado, ou null se cancelar
export const perguntar = (texto, valor = '', opcoes = {}) => abrir({ texto, campo: true, valor, ...opcoes });

export function responder(sim) {
  const r = dialogo.resolver;
  const resposta = dialogo.campo ? (sim ? dialogo.valor : null) : sim;
  Object.assign(dialogo, { aberto: false, resolver: null });
  r?.(resposta);
}
