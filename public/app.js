// =============================================================================
// APP.JS — Backlog Completo North Stack
// Gestão de Abas, Clientes Reais, Importação Inteligente (Max 5 / 10MB),
// Processamento em Tempo Real, Novas Entradas e Dashboard Analítico.
// =============================================================================

const estado = {
  categorias: [],
  imagensLote: [], // Array de objetos { id, file, blob, originalSize, compressedSize, previewUrl, status }
  enviando: false,
  abaAtiva: 'tab-novo-envio',
  fila: [],
  entradas: [],
  envioAberto: null
};

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  configurarNavegacaoAbas();
  configurarImportacaoImagens();
  configurarModais();
  configurarDrawerEnvio();
});

// Chamado por auth.js depois que o login é validado
let _timerApp = null;
window.iniciarApp = function () {
  carregarCategorias();
  carregarNovasEntradas();
  carregarDashboard();

  // Polling a cada 6 segundos para atualizar processamento e novas entradas
  clearInterval(_timerApp);
  _timerApp = setInterval(() => {
    if (estado.abaAtiva === 'tab-processamento') carregarFilaProcessamento();
    if (estado.abaAtiva === 'tab-novas-entradas') carregarNovasEntradas();
    if (estado.abaAtiva === 'tab-dashboard') carregarDashboard();
  }, 6000);
};

// ---------------------------------------------------------------------------
// 1. Navegação por Abas (Design System)
// ---------------------------------------------------------------------------
function configurarNavegacaoAbas() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      estado.abaAtiva = targetId;

      document.querySelectorAll('.tab-content').forEach((sec) => {
        sec.style.display = sec.id === targetId ? 'block' : 'none';
      });

      // Disparar atualizações específicas da aba
      if (targetId === 'tab-processamento') carregarFilaProcessamento();
      if (targetId === 'tab-novas-entradas') carregarNovasEntradas();
      if (targetId === 'tab-historico-envios') carregarHistoricoEnvios();
      if (targetId === 'tab-dashboard') carregarDashboard();
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Regras de Importação de Imagem (Item 2 do Backlog)
// ---------------------------------------------------------------------------
function configurarImportacaoImagens() {
  const dropzone = document.getElementById('dropzone');
  const fileCamera = document.getElementById('file-camera');
  const fileGaleria = document.getElementById('file-galeria');
  const btnCamera = document.getElementById('btn-trigger-camera');
  const btnGaleria = document.getElementById('btn-trigger-galeria');
  const btnEnviar = document.getElementById('btn-enviar-lote');

  btnCamera.addEventListener('click', (e) => { e.stopPropagation(); fileCamera.click(); });
  btnGaleria.addEventListener('click', (e) => { e.stopPropagation(); fileGaleria.click(); });
  dropzone.addEventListener('click', () => fileGaleria.click());

  // Drag and Drop
  ['dragenter', 'dragover'].forEach(evento => {
    dropzone.addEventListener(evento, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(evento => {
    dropzone.addEventListener(evento, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files) processarSelecaoArquivos(Array.from(files));
  });

  fileCamera.addEventListener('change', (e) => {
    if (e.target.files) processarSelecaoArquivos(Array.from(e.target.files));
    e.target.value = '';
  });

  fileGaleria.addEventListener('change', (e) => {
    if (e.target.files) processarSelecaoArquivos(Array.from(e.target.files));
    e.target.value = '';
  });

  btnEnviar.addEventListener('click', executarEnvioLote);
}

async function processarSelecaoArquivos(arquivosNovos) {
  const alerta = document.getElementById('alerta-limite-imagens');
  alerta.style.display = 'none';

  // Regra Item 2: Máximo 5 imagens por envio
  const validacao = validarLimiteQuantidade(arquivosNovos, estado.imagensLote.length);
  if (!validacao.valido) {
    alerta.textContent = validacao.erro;
    alerta.style.display = 'block';
    return;
  }

  for (const file of arquivosNovos) {
    if (!file.type.startsWith('image/')) continue;

    const item = {
      id: Math.random().toString(36).substring(2, 9),
      file,
      originalSize: file.size,
      compressedSize: file.size,
      previewUrl: URL.createObjectURL(file),
      statusTexto: 'Otimizando imagem...',
      pronto: false,
      blob: null
    };

    estado.imagensLote.push(item);
    renderizarMiniaturas();

    // Compactação assíncrona inteligente
    try {
      const res = await otimizarImagem(file, (msg) => {
        item.statusTexto = msg;
        renderizarMiniaturas();
      });

      item.blob = res.blob;
      item.compressedSize = res.tamanhoComprimido;
      item.previewUrl = res.urlPreview;
      item.statusTexto = `${formatarBytes(res.tamanhoOriginal)} → ${formatarBytes(res.tamanhoComprimido)}`;
      item.pronto = true;
    } catch (erro) {
      item.statusTexto = `Erro: ${erro.message}`;
      item.erro = true;
    }

    renderizarMiniaturas();
  }

  atualizarBotaoEnvio();
}

function renderizarMiniaturas() {
  const container = document.getElementById('previews-container');
  const contador = document.getElementById('contador-imagens-header');
  const resumo = document.getElementById('resumo-tamanho-total');

  contador.textContent = `${estado.imagensLote.length} / 5 imagens`;

  if (estado.imagensLote.length === 0) {
    container.innerHTML = '';
    resumo.textContent = '0 arquivos selecionados';
    return;
  }

  let totalBytes = estado.imagensLote.reduce((acc, i) => acc + (i.compressedSize || i.originalSize), 0);
  resumo.textContent = `${estado.imagensLote.length} imagem(ns) • Total: ~${formatarBytes(totalBytes)}`;

  container.innerHTML = estado.imagensLote.map(item => `
    <div class="preview-card" id="card-${item.id}">
      <button type="button" class="preview-btn-remover" onclick="removerImagemLote('${item.id}')" title="Remover imagem" aria-label="Remover imagem"><svg class="ic" aria-hidden="true"><use href="/icons.svg#i-x"/></svg></button>
      <img src="${item.previewUrl}" class="preview-thumb" alt="Preview">
      <div class="preview-details">
        <div style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${item.file.name}</div>
        <div class="preview-badge-size" style="${item.erro ? 'color: var(--danger-text);' : ''}">
          <span>${item.statusTexto}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function rotulo(t){ t=String(t||''); return t.charAt(0).toUpperCase()+t.slice(1); }

window.removerImagemLote = function(id) {
  const index = estado.imagensLote.findIndex(i => i.id === id);
  if (index !== -1) {
    if (estado.imagensLote[index].previewUrl) {
      URL.revokeObjectURL(estado.imagensLote[index].previewUrl);
    }
    estado.imagensLote.splice(index, 1);
    renderizarMiniaturas();
    atualizarBotaoEnvio();
  }
};

function atualizarBotaoEnvio() {
  const btn = document.getElementById('btn-enviar-lote');
  const temImagens = estado.imagensLote.length > 0;
  const todasProntas = estado.imagensLote.every(i => i.pronto);

  btn.disabled = !(temImagens && todasProntas && !estado.enviando);
}

// ---------------------------------------------------------------------------
// 4. Execução do Envio em Lote (Item 2 & 4)
// ---------------------------------------------------------------------------
async function executarEnvioLote() {
  if (estado.enviando) return;
  estado.enviando = true;
  atualizarBotaoEnvio();

  const btn = document.getElementById('btn-enviar-lote');
  btn.textContent = 'Enviando comprovantes...';

  try {
    for (const item of estado.imagensLote) {
      const formData = new FormData();
      formData.append('imagem', item.blob || item.file, item.file.name);
      formData.append('tamanho_original', item.originalSize);
      formData.append('tamanho_comprimido', item.compressedSize);

      const resp = await fetch('/api/upload-cupom', {
        method: 'POST',
        body: formData
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.erro || 'o servidor recusou o envio');
      }
    }

    // Limpar lote e mudar para a aba de processamento
    estado.imagensLote = [];
    renderizarMiniaturas();
    toast('Envio feito. A IA já está lendo os comprovantes.');

    // Dispara a leitura na hora (na Vercel, onde o cron do plano Hobby é diário)
    dispararProcessamentoFila();

    // Alternar para aba Processamento
    const tabProcessamento = document.querySelector('[data-tab="tab-processamento"]');
    if (tabProcessamento) tabProcessamento.click();

  } catch (e) {
    toast('Não foi possível enviar: ' + e.message, 'erro');
  } finally {
    estado.enviando = false;
    btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/icons.svg#i-send"/></svg> Enviar e processar';
    atualizarBotaoEnvio();
  }
}

// ---------------------------------------------------------------------------
// 5. Visão de Processamento em Tempo Real (Item 4)
// ---------------------------------------------------------------------------
const SITUACAO_FILA = {
  pendente:       { rotulo: 'Na fila',            classe: 'badge-novo' },
  processando:    { rotulo: 'Lendo com IA',       classe: 'badge-revisar' },
  processado:     { rotulo: 'Concluído',          classe: 'badge-confirmado' },
  revisao_manual: { rotulo: 'Precisa de revisão', classe: 'badge-baixa' }
};
const MAX_TENTATIVAS = 5;

function svgIc(nome, extra = '') {
  return `<svg class="ic${extra}" aria-hidden="true"><use href="/icons.svg#i-${nome}"/></svg>`;
}
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR') + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function reais(v) {
  return (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function carregarFilaProcessamento() {
  const tbody = document.getElementById('lista-fila-processamento');

  try {
    const [resFila, resEntradas] = await Promise.all([
      fetch('/api/processamento-fila'),
      fetch('/api/novas-entradas')
    ]);
    if (!resFila.ok) throw new Error('Erro ao buscar fila');
    const itens = await resFila.json();
    estado.fila = Array.isArray(itens) ? itens : [];
    estado.entradas = resEntradas.ok ? await resEntradas.json() : [];

    if (estado.fila.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">
        <div class="empty-state-icon">${svgIc('circle-check', ' ic--lg')}</div>
        <div class="empty-state-text">Nenhum envio por aqui ainda. Envie um comprovante na aba Novo Envio.</div>
      </td></tr>`;
    } else {
      tbody.innerHTML = estado.fila.map(item => {
        const sit = SITUACAO_FILA[item.status] || { rotulo: item.status, classe: 'badge-neutro' };
        const qtd = estado.entradas.filter(e => e.cupom_id === item.id).length;
        return `
          <tr class="linha-envio" tabindex="0" role="button" data-id="${esc(item.id)}" aria-label="Ver detalhamento do envio de ${dataHora(item.criado_em)}">
            <td>${dataHora(item.criado_em)}</td>
            <td>${formatarBytes(item.tamanho_comprimido_bytes)}</td>
            <td><span class="badge ${sit.classe}">${sit.rotulo}</span></td>
            <td>${item.tentativas || 0} de ${MAX_TENTATIVAS}</td>
            <td>${qtd > 0 ? qtd : '—'}</td>
            <td>${svgIc('chevron-right')}</td>
          </tr>`;
      }).join('');
    }

    // Se o painel está aberto, mantém o conteúdo atualizado com o polling
    if (estado.envioAberto) renderizarDrawerEnvio(estado.envioAberto);

    // Se houver envio pendente na fila, aciona a leitura imediatamente
    if (estado.fila.some(i => i.status === 'pendente')) {
      dispararProcessamentoFila();
    }
  } catch (e) {
    console.error('Erro na fila:', e);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Não foi possível carregar os envios. Tente de novo em instantes.</td></tr>';
  }
}

let processandoFilaAgora = false;
function dispararProcessamentoFila() {
  if (processandoFilaAgora) return;
  processandoFilaAgora = true;
  fetch('/api/processar-fila', { method: 'POST' })
    .then(r => { if (r.ok) carregarFilaProcessamento(); })
    .catch(() => {})
    .finally(() => { processandoFilaAgora = false; });
}

// ---- Painel lateral: detalhamento do envio ----
function configurarDrawerEnvio() {
  const tbody = document.getElementById('lista-fila-processamento');
  const abrir = (tr) => { if (tr && tr.dataset.id) abrirDrawerEnvio(tr.dataset.id, tr); };
  tbody.addEventListener('click', (ev) => abrir(ev.target.closest('tr.linha-envio')));
  tbody.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      const tr = ev.target.closest('tr.linha-envio');
      if (tr) { ev.preventDefault(); abrir(tr); }
    }
  });
  document.getElementById('drawer-fechar').addEventListener('click', fecharDrawerEnvio);
  document.getElementById('drawer-veu').addEventListener('click', fecharDrawerEnvio);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && estado.envioAberto) fecharDrawerEnvio();
  });
}

function abrirDrawerEnvio(id, origem) {
  estado.envioAberto = id;
  estado.drawerOrigem = origem || null;
  renderizarDrawerEnvio(id);
  document.getElementById('drawer-veu').hidden = false;
  document.getElementById('drawer-envio').hidden = false;
  document.getElementById('drawer-fechar').focus();
}

function fecharDrawerEnvio() {
  const id = estado.envioAberto;
  estado.envioAberto = null;
  document.getElementById('drawer-veu').hidden = true;
  document.getElementById('drawer-envio').hidden = true;
  // A lista é redesenhada a cada 6 s: devolve o foco à linha pelo id
  const linha = id ? document.querySelector(`tr.linha-envio[data-id="${CSS.escape(id)}"]`) : null;
  if (linha) linha.focus();
}

function passosDoEnvio(item) {
  const st = item.status;
  const falhou = st === 'revisao_manual';
  const passos = [
    { t: 'Enviado', q: `Foto recebida e guardada · ${dataHora(item.criado_em)}`, c: 'ok' },
    { t: 'Na fila de leitura', q: st === 'pendente' ? (item.proxima_tentativa_em ? `Próxima tentativa: ${dataHora(item.proxima_tentativa_em)}` : 'Aguardando a próxima rodada de leitura') : 'Foi para leitura', c: st === 'pendente' ? 'atual' : 'ok' }
  ];
  if (st === 'pendente') {
    passos.push({ t: 'Leitura pela IA', q: 'Ainda não começou', c: 'futuro' });
    passos.push({ t: 'Conferência dos dados', q: 'Depois da leitura', c: 'futuro' });
  } else if (st === 'processando') {
    passos.push({ t: 'Leitura pela IA', q: `Em andamento desde ${dataHora(item.atualizado_em)}`, c: 'atual' });
    passos.push({ t: 'Conferência dos dados', q: 'Depois da leitura', c: 'futuro' });
  } else if (falhou) {
    passos.push({ t: 'Leitura pela IA', q: `Não concluída · ${item.tentativas || 0} de ${MAX_TENTATIVAS} tentativas · ${dataHora(item.atualizado_em)}`, c: 'erro' });
    passos.push({ t: 'Conferência dos dados', q: 'Pendente da revisão manual', c: 'futuro' });
  } else {
    passos.push({ t: 'Leitura pela IA', q: `Concluída · ${dataHora(item.atualizado_em)}`, c: 'ok' });
    passos.push({ t: 'Conferência dos dados', q: 'Os lançamentos estão na aba Novas Entradas', c: 'ok' });
  }
  return passos;
}

function renderizarDrawerEnvio(id) {
  const item = (estado.fila || []).find(f => f.id === id);
  if (!item) { fecharDrawerEnvio(); return; }
  const sit = SITUACAO_FILA[item.status] || { rotulo: item.status, classe: 'badge-neutro' };
  const lancs = (estado.entradas || []).filter(e => e.cupom_id === id);
  const orig = Number(item.tamanho_original_bytes) || 0;
  const comp = Number(item.tamanho_comprimido_bytes) || 0;
  const reducao = orig > 0 && comp > 0 ? Math.max(0, Math.round((1 - comp / orig) * 100)) : null;

  document.getElementById('drawer-titulo').textContent = `Envio de ${dataHora(item.criado_em)}`;
  const badge = document.getElementById('drawer-situacao');
  badge.textContent = sit.rotulo;
  badge.className = `badge ${sit.classe}`;

  const passos = passosDoEnvio(item).map(p => `
    <li class="${p.c}"><div class="tl__t">${p.t}</div><div class="tl__q">${esc(p.q)}</div></li>`).join('');

  const erro = item.ultimo_erro ? `
    <div class="callout" role="alert">${svgIc('circle-alert')}
      <div><strong>${item.status === 'revisao_manual' ? 'A IA não conseguiu ler este envio' : 'Último erro registrado'}</strong>
      <p>${esc(item.ultimo_erro)}</p></div>
    </div>` : '';

  const lancHtml = lancs.length ? lancs.map(l => `
    <div class="dr-lanc">
      <div style="min-width: 0;">
        <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(l.estabelecimento || 'Não identificado')}</div>
        <span class="sub">${l.data_emissao ? l.data_emissao.split('-').reverse().join('/') : 'Sem data'} · ${esc(l.categoria || 'Outros')}</span>
      </div>
      <div style="text-align: right; flex: none;"><div class="td-valor">${reais(l.valor_total)}</div>
        <span class="badge badge-${esc(l.confianca || 'alta')}">${rotulo(l.confianca || 'alta')}</span></div>
    </div>`).join('') : `<p class="ds-card-subtitle">${item.status === 'processado' ? 'A IA não encontrou lançamentos neste envio.' : 'Ainda não há dados lidos deste envio.'}</p>`;

  const corpo = document.getElementById('drawer-corpo');
  const topo = corpo.scrollTop;
  corpo.innerHTML = `
    ${erro}
    <section class="dr-sec"><h3>Passo a passo</h3><ol class="tl">${passos}</ol></section>
    <section class="dr-sec"><h3>Dados do envio</h3>
      <dl class="dr-grid">
        <div><dt>Enviado em</dt><dd>${dataHora(item.criado_em)}</dd></div>
        <div><dt>Tamanho original</dt><dd>${orig ? formatarBytes(orig) : '—'}</dd></div>
        <div><dt>Depois de compactar</dt><dd>${comp ? formatarBytes(comp) : '—'}${reducao !== null ? ` (−${reducao}%)` : ''}</dd></div>
        <div><dt>Tentativas de leitura</dt><dd>${item.tentativas || 0} de ${MAX_TENTATIVAS}</dd></div>
        <div><dt>Última atualização</dt><dd>${dataHora(item.atualizado_em)}</dd></div>
        <div class="full"><dt>Arquivo guardado</dt><dd class="mono" title="${esc(item.storage_path)}">${esc(item.storage_path)}</dd></div>
        <div class="full"><dt>Código do envio</dt><dd class="mono">${esc(item.id)}</dd></div>
      </dl>
    </section>
    <section class="dr-sec"><h3>O que a IA leu (${lancs.length})</h3>${lancHtml}</section>
    <section class="dr-sec"><h3>Foto enviada</h3>
      <div class="dr-foto"><img data-src-protegida="/api/imagem-cupom?path=${encodeURIComponent(item.storage_path)}" alt="Foto do comprovante enviado"></div>
    </section>`;
  corpo.scrollTop = topo;
  preencherImagens(corpo);

  const rodape = document.getElementById('drawer-rodape');
  const podeReprocessar = item.status === 'revisao_manual';
  rodape.innerHTML = `
    <button type="button" class="btn btn-secondary" id="drawer-btn-fechar">Fechar</button>
    ${podeReprocessar ? `<button type="button" class="btn btn-primary" id="drawer-btn-reprocessar">${svgIc('refresh-cw')} Tentar a leitura de novo</button>` : ''}`;
  document.getElementById('drawer-btn-fechar').addEventListener('click', fecharDrawerEnvio);
  const br = document.getElementById('drawer-btn-reprocessar');
  if (br) br.addEventListener('click', () => reprocessarEnvio(id, br));
}

async function reprocessarEnvio(id, botao) {
  botao.disabled = true;
  botao.textContent = 'Reenviando…';
  try {
    const res = await fetch('/api/reprocessar-cupom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro || 'Falha ao reenviar');
    toast('Leitura reiniciada. Acompanhe o passo a passo aqui.', 'info');
    dispararProcessamentoFila();
    await carregarFilaProcessamento();
  } catch (e) {
    toast('Não foi possível tentar de novo: ' + e.message, 'erro');
    botao.disabled = false;
    botao.innerHTML = svgIc('refresh-cw') + ' Tentar a leitura de novo';
  }
}

// ---------------------------------------------------------------------------
// 6. Novas Entradas & Ações (Item 5.3)
// ---------------------------------------------------------------------------
async function carregarCategorias() {
  try {
    const res = await fetch('/api/categorias');
    if (res.ok) estado.categorias = await res.json();
  } catch (e) {}
}

async function carregarNovasEntradas() {
  const tbody = document.getElementById('tbody-novas-entradas');
  const countBadge = document.getElementById('badge-novas-entradas');
  const countConfirmar = document.getElementById('count-confirmar-todos');

  try {
    const res = await fetch('/api/novas-entradas');
    if (!res.ok) throw new Error('Erro ao buscar novas entradas');
    const entradas = await res.json();

    const pendentes = entradas.filter(e => e.status_revisao !== 'confirmado');
    countBadge.textContent = pendentes.length;
    countBadge.style.display = pendentes.length > 0 ? 'inline-block' : 'none';
    countConfirmar.textContent = pendentes.length;

    if (!entradas || entradas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum comprovante registrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = entradas.map(item => {
      const conf = item.confianca || 'alta';
      const confiancaBadge = conf === 'alta' ? 'badge-alta' : (conf === 'media' ? 'badge-media' : 'badge-baixa');
      const statusBadge = item.status_revisao === 'confirmado' ? 'badge-confirmado' : (item.status_revisao === 'revisar' ? 'badge-revisar' : 'badge-novo');
      const dataFormatada = item.data_emissao ? item.data_emissao.split('-').reverse().join('/') : 'n/d';
      const valorFormatado = (parseFloat(item.valor_total) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      return `
        <tr>
          <td>${dataFormatada}</td>
          <td>
            <div style="font-weight: 600;">${item.estabelecimento || 'Não identificado'}</div>
            ${item.cnpj ? `<div style="font-size: 0.7rem; color: var(--text-muted);">${item.cnpj}</div>` : ''}
          </td>
          <td>
            <span class="badge badge-neutro"><svg class="ic" aria-hidden="true"><use href="/icons.svg#i-tag"/></svg> ${item.categoria || 'Outros'}</span>
          </td>
          <td class="td-valor">${valorFormatado}</td>
          <td><span class="badge ${confiancaBadge}">${rotulo(item.confianca || 'alta')}</span></td>
          <td><span class="badge ${statusBadge}">${rotulo(item.status_revisao || 'novo')}</span></td>
          <td>
            <div class="cell-actions">
              ${item.status_revisao !== 'confirmado' ? `
                <button type="button" class="btn btn-sm btn-primary" onclick="confirmarEntradaIndividual('${item.id}')" title="Confirmar lançamento" aria-label="Confirmar lançamento"><svg class="ic" aria-hidden="true"><use href="/icons.svg#i-check"/></svg></button>
              ` : ''}
              <button type="button" class="btn btn-sm btn-secondary" onclick="verComprovanteOriginal('${item.cupom_id}')" title="Ver foto original" aria-label="Ver foto original"><svg class="ic" aria-hidden="true"><use href="/icons.svg#i-search"/></svg></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Erro ao carregar entradas.</td></tr>';
  }
}

window.confirmarEntradaIndividual = async function(id) {
  try {
    const res = await fetch('/api/confirmar-entrada', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error('o servidor recusou a confirmação');
    toast('Lançamento confirmado.');
    carregarNovasEntradas();
    carregarDashboard();
  } catch (e) {
    toast('Não foi possível confirmar: ' + e.message, 'erro');
  }
};

document.getElementById('btn-confirmar-todos').addEventListener('click', async () => {
  const qtd = parseInt(document.getElementById('count-confirmar-todos').textContent, 10) || 0;
  if (qtd === 0) { toast('Não há lançamentos pendentes para confirmar.', 'info'); return; }
  const sim = await confirmar({
    titulo: qtd === 1 ? 'Confirmar 1 lançamento?' : `Confirmar ${qtd} lançamentos?`,
    texto: 'Eles seguem para o painel oficial e entram nos totais do dashboard. Confira os valores antes se tiver dúvida.',
    acao: qtd === 1 ? 'Confirmar lançamento' : `Confirmar ${qtd} lançamentos`
  });
  if (!sim) return;
  try {
    const res = await fetch('/api/confirmar-todas', { method: 'POST' });
    if (!res.ok) throw new Error('o servidor recusou a confirmação');
    toast(qtd === 1 ? '1 lançamento confirmado.' : `${qtd} lançamentos confirmados.`);
    carregarNovasEntradas();
    carregarDashboard();
  } catch (e) {
    toast('Não foi possível confirmar: ' + e.message, 'erro');
  }
});

// ---------------------------------------------------------------------------
// 7. Dashboard de Controle (Item 5.4)
// ---------------------------------------------------------------------------
// carregarDashboard() agora vive em dashboard.js

// ---------------------------------------------------------------------------
// 8. Modais & Comprovante Original
// ---------------------------------------------------------------------------
function configurarModais() {
  document.querySelectorAll('.btn-fechar-modal').forEach(btn => {
    btn.addEventListener('click', fecharTodosModais);
  });
}

function fecharTodosModais() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

window.verComprovanteOriginal = async function(cupomId) {
  try {
    // 1. Buscar a entrada correspondente
    const resEntradas = await fetch('/api/novas-entradas');
    const entradas = await resEntradas.json();
    const entrada = entradas.find(e => e.cupom_id === cupomId || e.id === cupomId);

    // 2. Buscar o item da fila para pegar o path correto da imagem
    const resFila = await fetch('/api/processamento-fila');
    const fila = await resFila.json();
    const itemFila = fila.find(f => f.id === cupomId);

    const storagePath = itemFila ? itemFila.storage_path : (entrada ? entrada.storage_path : '');

    if (storagePath) {
      const imgModal = document.getElementById('img-modal-comprovante');
      imgModal.removeAttribute('src');
      imagemProtegida(`/api/imagem-cupom?path=${encodeURIComponent(storagePath)}`).then((u) => { imgModal.src = u; }).catch(() => { imgModal.alt = 'Não foi possível carregar a foto.'; });
    } else {
      document.getElementById('img-modal-comprovante').src = '';
    }

    // 3. Preencher os detalhes no modal
    if (entrada) {
      document.getElementById('modal-detalhe-estab').textContent = entrada.estabelecimento || 'Não identificado';
      document.getElementById('modal-detalhe-cnpj').textContent = entrada.cnpj ? `CNPJ: ${entrada.cnpj}` : 'CNPJ não informado';
      document.getElementById('modal-detalhe-data').textContent = entrada.data_emissao ? entrada.data_emissao.split('-').reverse().join('/') : 'n/d';
      document.getElementById('modal-detalhe-valor').textContent = (parseFloat(entrada.valor_total) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      document.getElementById('modal-detalhe-categoria').textContent = entrada.categoria || 'Outros';
      document.getElementById('modal-detalhe-pagamento').textContent = entrada.forma_pagamento || 'Outros';
      document.getElementById('modal-detalhe-itens').textContent = entrada.resumo_itens || 'Nenhum item discriminado.';
      
      const badgeConf = document.getElementById('modal-detalhe-confianca');
      badgeConf.textContent = (entrada.confianca || 'alta').toUpperCase();
      badgeConf.className = `badge badge-${entrada.confianca || 'alta'}`;
    }

    document.getElementById('modal-ver-comprovante').classList.add('open');
  } catch (e) {
    toast('Não foi possível abrir o comprovante: ' + e.message, 'erro');
  }
};

document.getElementById('btn-reprocessar-pendentes').addEventListener('click', carregarFilaProcessamento);


// ---------------------------------------------------------------------------
// Histórico consolidado de envios (aba Histórico de Envios)
// ---------------------------------------------------------------------------
async function carregarHistoricoEnvios() {
  const tbody = document.getElementById('tbody-historico-envios');
  try {
    const [resFila, resEntradas] = await Promise.all([fetch('/api/processamento-fila'), fetch('/api/novas-entradas')]);
    if (!resFila.ok) throw new Error('Erro ao buscar envios');
    estado.fila = await resFila.json();
    estado.entradas = resEntradas.ok ? await resEntradas.json() : [];
    renderizarHistoricoEnvios();
  } catch (e) {
    console.error('Erro no histórico:', e);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Não foi possível carregar o histórico. Tente de novo em instantes.</td></tr>';
  }
}

function renderizarHistoricoEnvios() {
  const tbody = document.getElementById('tbody-historico-envios');
  const termo = (document.getElementById('filtro-busca-historico').value || '').trim().toLowerCase();
  const lista = (estado.fila || []).filter((item) => {
    if (!termo) return true;
    const sit = (SITUACAO_FILA[item.status] || {}).rotulo || item.status;
    return `${sit} ${dataHora(item.criado_em)}`.toLowerCase().includes(termo);
  });

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${termo ? 'Nenhum envio encontrado para essa busca.' : 'Nenhum envio registrado ainda.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((item) => {
    const sit = SITUACAO_FILA[item.status] || { rotulo: item.status, classe: 'badge-neutro' };
    const lancs = (estado.entradas || []).filter((e) => e.cupom_id === item.id);
    const total = lancs.reduce((s, e) => s + (parseFloat(e.valor_total) || 0), 0);
    return `
      <tr class="linha-envio" tabindex="0" role="button" data-id="${esc(item.id)}" aria-label="Ver detalhamento do envio de ${dataHora(item.criado_em)}">
        <td>${dataHora(item.criado_em)}</td>
        <td>${formatarBytes(item.tamanho_comprimido_bytes)}</td>
        <td><span class="badge ${sit.classe}">${sit.rotulo}</span></td>
        <td>${lancs.length || '—'}</td>
        <td class="td-valor">${lancs.length ? reais(total) : '—'}</td>
        <td>${svgIc('chevron-right')}</td>
      </tr>`;
  }).join('');
}

document.getElementById('filtro-busca-historico').addEventListener('input', renderizarHistoricoEnvios);
document.getElementById('tbody-historico-envios').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr.linha-envio');
  if (tr && tr.dataset.id) abrirDrawerEnvio(tr.dataset.id, tr);
});
document.getElementById('tbody-historico-envios').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    const tr = ev.target.closest('tr.linha-envio');
    if (tr) { ev.preventDefault(); abrirDrawerEnvio(tr.dataset.id, tr); }
  }
});
