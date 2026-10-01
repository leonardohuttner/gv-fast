export class NaoLogado extends Error {}

async function chamar(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new NaoLogado(j.erro || 'Faça login.');
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

export const api = {
  sessao: () => chamar('GET', '/api/sessao'),
  login: (cpf, senha) => chamar('POST', '/api/login', { cpf, senha }),
  logout: () => chamar('POST', '/api/logout'),
  agenda: () => chamar('GET', '/api/agenda'),
  salas: () => chamar('GET', '/api/salas'),
  criarSala: (nome, cpts) => chamar('POST', '/api/salas', { nome, cpts }),
  removerSala: (id) => chamar('DELETE', `/api/salas/${id}`),
  turmas: () => chamar('GET', '/api/turmas'),
  ocultarTurmas: (cpts, ocultar = true) => chamar('POST', '/api/turmas/ocultar', { cpts, ocultar }),
  resumo: (cpt) => chamar('GET', `/api/turmas/${cpt}/resumo`),
  aulas: (sala) => chamar('GET', `/api/salas/${sala}/aulas`),
  chamada: (sala, data) => chamar('GET', `/api/salas/${sala}/chamada?data=${data}`),
  observacoes: (sala, data) => chamar('GET', `/api/salas/${sala}/observacoes?data=${data ?? ''}`),
  salvarObservacao: (sala, cpt, data, texto) => chamar('PUT', `/api/salas/${sala}/observacoes`, { cpt, data, texto }),
  atualizarResultado: (sala) => chamar('POST', `/api/salas/${sala}/resultado`),
  avaliacoes: (sala) => chamar('GET', `/api/salas/${sala}/avaliacoes`),
  salvarAvaliacoes: (sala, novas, confirmar = []) => chamar('POST', `/api/salas/${sala}/avaliacoes`, { novas, confirmar }),
  salvarChamada: (sala, data, alunos) => chamar('POST', `/api/salas/${sala}/chamada`, { data, alunos }),
};
