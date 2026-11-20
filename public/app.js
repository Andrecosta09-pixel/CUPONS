// =============================================================================
// APP.JS — Backlog Completo North Stack
// Gestão de Abas, Clientes Reais, Importação Inteligente (Max 5 / 10MB),
// Processamento em Tempo Real, Novas Entradas e Dashboard Analítico.
// =============================================================================

const estado = {
  clienteSelecionado: '',
  clientes: [],
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
  configurarClientes();
  configurarImportacaoImagens();
  configurarModais();
  configurarDrawerEnvio();

  // Carregar dados iniciais
  carregarClientes();
  carregarCategorias();
  carregarNovasEntradas();
  carregarDashboard();

  // Polling a cada 6 segundos para atualizar processamento e novas entradas
  setInterval(() => {
    if (estado.abaAtiva === 'tab-processamento') carregarFilaProcessamento();
    if (estado.abaAtiva === 'tab-novas-entradas') carregarNovasEntradas();
    if (estado.abaAtiva === 'tab-dashboard') carregarDashboard();
  }, 6000);
});

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
// 2. Clientes Reais (Item 3 do Backlog — Sem Mocks)
// ---------------------------------------------------------------------------
async function carregarClientes() {
  const select = document.getElementById('select-cliente');
  const empty = document.getElementById('empty-clientes');
  const wrapper = document.getElementById('wrapper-cliente');

  try {
    const res = await fetch('/api/clientes');
    if (!res.ok) throw new Error('Falha ao buscar clientes');
    estado.clientes = await res.json();

    if (!estado.clientes || estado.clientes.length === 0) {
      wrapper.style.display = 'none';
      empty.style.display = 'block';
      select.innerHTML = '<option value="">Nenhum cliente cadastrado</option>';
      estado.clienteSelecionado = '';
    } else {
      wrapper.style.display = 'block';
      empty.style.display = 'none';
      select.innerHTML = '<option value="">-- Selecione o Cliente / Unidade --</option>' +
        estado.clientes.map(c => `<option value="${c.nome}">${c.nome}${c.documento ? ` (${c.documento})` : ''}</option>`).join('');
      
      // Manter seleção se possível
      if (estado.clienteSelecionado) {
        select.value = estado.clienteSelecionado;
      }
    }
  } catch (e) {
    console.error('Erro ao carregar clientes:', e);
  }
}

function configurarClientes() {
  const select = document.getElementById('select-cliente');
  select.addEventListener('change', (e) => {
    estado.clienteSelecionado = e.target.value;
    atualizarBotaoEnvio();
  });

  const btnSalvar = document.getElementById('btn-salvar-novo-cliente');
  btnSalvar.addEventListener('click', async () => {
    const inputNome = document.getElementById('input-novo-cliente-nome');
    const inputDoc = document.getElementById('input-novo-cliente-doc');
    const nome = inputNome.value.trim();
    const doc = inputDoc.value.trim();

    if (!nome) {
      alert('Informe o nome do cliente.');
      return;
    }

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';

    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, documento: doc })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.erro || 'Erro ao salvar cliente');
      }

      const novo = await res.json();
      fecharTodosModais();
      inputNome.value = '';
      inputDoc.value = '';
      estado.clienteSelecionado = novo.nome;
      await carregarClientes();
    } catch (e) {
      alert(e.message);
    } finally {
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar Cliente';
    }
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
  const temCliente = !!estado.clienteSelecionado;
  const temImagens = estado.imagensLote.length > 0;
  const todasProntas = estado.imagensLote.every(i => i.pronto);

  btn.disabled = !(temCliente && temImagens && todasProntas && !estado.enviando);
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
      formData.append('cliente', estado.clienteSelecionado);
      formData.append('tamanho_original', item.originalSize);
      formData.append('tamanho_comprimido', item.compressedSize);

      await fetch('/api/upload-cupom', {
        method: 'POST',
        body: formData
      });
    }

    // Limpar lote e mudar para a aba de processamento
    estado.imagensLote = [];
    renderizarMiniaturas();
    alert('Comprovante(s) enviado(s) com sucesso! Redirecionando para a fila de processamento.');

    // Alternar para aba Processamento
    const tabProcessamento = document.querySelector('[data-tab="tab-processamento"]');
    if (tabProcessamento) tabProcessamento.click();

  } catch (e) {
    alert('Erro ao enviar lote: ' + e.message);
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
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">
        <div class="empty-state-icon">${svgIc('circle-check', ' ic--lg')}</div>
        <div class="empty-state-text">Nenhum envio por aqui ainda. Envie um comprovante na aba Novo Envio.</div>
      </td></tr>`;
    } else {
      tbody.innerHTML = estado.fila.map(item => {
        const sit = SITUACAO_FILA[item.status] || { rotulo: item.status, classe: 'badge-neutro' };
        const qtd = estado.entradas.filter(e => e.cupom_id === item.id).length;
        return `
          <tr class="linha-envio" tabindex="0" role="button" data-id="${esc(item.id)}" aria-label="Ver detalhamento do envio de ${esc(item.cliente)}">
            <td>${dataHora(item.criado_em)}</td>
            <td>${esc(item.cliente)}</td>
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
  } catch (e) {
    console.error('Erro na fila:', e);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Não foi possível carregar os envios. Tente de novo em instantes.</td></tr>';
  }
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

  document.getElementById('drawer-titulo').textContent = `${item.cliente} · ${dataHora(item.criado_em)}`;
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
        <div><dt>Cliente</dt><dd>${esc(item.cliente)}</dd></div>
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
      <div class="dr-foto"><img src="/api/imagem-cupom?path=${encodeURIComponent(item.storage_path)}" alt="Foto do comprovante enviado" loading="lazy"></div>
    </section>`;
  corpo.scrollTop = topo;

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
    await carregarFilaProcessamento();
  } catch (e) {
    alert('Não foi possível tentar de novo: ' + e.message);
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
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum comprovante registrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = entradas.map(item => {
      const confiancaBadge = item.confianca === 'alta' ? 'badge-alta' : (item.confianca === 'media' ? 'badge-media' : 'badge-baixa');
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
          <td>${item.cliente}</td>
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
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Erro ao carregar entradas.</td></tr>';
  }
}

window.confirmarEntradaIndividual = async function(id) {
  try {
    await fetch('/api/confirmar-entrada', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    carregarNovasEntradas();
    carregarDashboard();
  } catch (e) {
    alert('Erro ao confirmar: ' + e.message);
  }
};

document.getElementById('btn-confirmar-todos').addEventListener('click', async () => {
  if (!confirm('Confirmar todos os comprovantes pendentes?')) return;
  try {
    await fetch('/api/confirmar-todas', { method: 'POST' });
    carregarNovasEntradas();
    carregarDashboard();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
});

// ---------------------------------------------------------------------------
// 7. Dashboard de Controle (Item 5.4)
// ---------------------------------------------------------------------------
async function carregarDashboard() {
  try {
    const res = await fetch('/api/dashboard-stats');
    if (!res.ok) throw new Error('Erro stats');
    const stats = await res.json();

    document.getElementById('dash-total-periodo').textContent = (stats.total_periodo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('dash-total-comprovantes').textContent = stats.qtd_comprovantes || 0;
    document.getElementById('dash-ticket-medio').textContent = (stats.ticket_medio || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('dash-pendentes-revisao').textContent = stats.pendentes_revisao || 0;

    // Categorias
    const catContainer = document.getElementById('dash-gastos-categoria');
    if (!stats.gastos_categoria || stats.gastos_categoria.length === 0) {
      catContainer.innerHTML = '<div class="empty-state">Sem dados.</div>';
    } else {
      catContainer.innerHTML = stats.gastos_categoria.map(cat => {
        const perc = stats.total_periodo > 0 ? ((cat.total / stats.total_periodo) * 100).toFixed(1) : 0;
        return `
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
              <span>${cat.categoria}</span>
              <span style="font-weight: 600;">${cat.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${perc}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${perc}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Top Estabelecimentos
    const estabContainer = document.getElementById('dash-top-estabelecimentos');
    if (!stats.top_estabelecimentos || stats.top_estabelecimentos.length === 0) {
      estabContainer.innerHTML = '<div class="empty-state">Sem dados.</div>';
    } else {
      estabContainer.innerHTML = stats.top_estabelecimentos.map((est, idx) => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-subtle);">
          <div style="font-size: 0.85rem; font-weight: 500;">${idx + 1}. ${est.nome}</div>
          <div style="font-weight: 600; color: var(--c-strong); font-size: 13px;">${est.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
        </div>
      `).join('');
    }

  } catch (e) {
    console.error('Erro dashboard:', e);
  }
}

// ---------------------------------------------------------------------------
// 8. Modais & Comprovante Original
// ---------------------------------------------------------------------------
function configurarModais() {
  document.getElementById('btn-abrir-modal-cliente').addEventListener('click', () => {
    document.getElementById('modal-novo-cliente').classList.add('open');
  });

  document.querySelectorAll('.btn-trigger-modal-cliente').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('modal-novo-cliente').classList.add('open');
    });
  });

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
      document.getElementById('img-modal-comprovante').src = `/api/imagem-cupom?path=${encodeURIComponent(storagePath)}`;
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
    alert('Erro ao carregar detalhamento do comprovante: ' + e.message);
  }
};

document.getElementById('btn-reprocessar-pendentes').addEventListener('click', carregarFilaProcessamento);
