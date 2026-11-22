// =============================================================================
// ADMIN.JS — Ambiente administrativo: gestão de clientes, convites e controle
// de uso (envios no mês, cupons lidos, armazenamento e limites mensais).
// =============================================================================
(function () {
  const ic = (n, x = '') => `<svg class="ic${x}" aria-hidden="true"><use href="/icons.svg#i-${n}"/></svg>`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtMb(bytes) {
    const mb = (Number(bytes) || 0) / (1024 * 1024);
    return mb < 0.1 && bytes > 0 ? '< 0,1 MB' : mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
  }

  function fmtData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR') + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  const SIT = {
    ativo: { rotulo: 'Ativo', cls: 'badge-confirmado' },
    convite_pendente: { rotulo: 'Convite pendente', cls: 'badge-novo' },
    sem_email: { rotulo: 'Sem e-mail', cls: 'badge-neutro' },
    bloqueado: { rotulo: 'Bloqueado', cls: 'badge-revisar' }
  };

  let dadosCache = null;
  let editandoCliente = null; // { id, modo: 'email'|'limite' }

  async function acaoAdmin(payload) {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo.erro || 'Falha na operação.');
    if (typeof window.toast === 'function') window.toast(corpo.mensagem || 'Atualizado.');
    editandoCliente = null;
    await window.carregarAdmin();
  }

  function render() {
    const raiz = document.getElementById('admin-root');
    if (!raiz || !dadosCache) return;
    const r = dadosCache.resumo || {};
    const lista = dadosCache.clientes || [];

    const kpi = (icone, rotulo, valor, sub) => `
      <div class="ds-card kpi-card">
        <div class="kpi-card__top"><span class="kpi-card__ico">${ic(icone)}</span><span class="ds-card-subtitle" style="margin:0;">${rotulo}</span></div>
        <div class="kpi">${valor}</div>
        <div class="kpi-card__foot"><span class="kpi__cmp">${sub}</span></div>
      </div>`;

    const linhas = lista.map((c) => {
      const s = SIT[c.situacao] || SIT.sem_email;
      const u = c.uso || {};
      const lim = c.limite_mensal_envios;
      const pctUso = lim ? Math.min(100, Math.round(((u.envios_mes || 0) / lim) * 100)) : 0;
      const barraUso = lim
        ? `<div class="progress-bar-bg" style="margin-top:4px; max-width:110px;"><div class="progress-bar-fill${pctUso >= 90 ? ' fill-bad' : ''}" style="width:${pctUso}%"></div></div>`
        : '';

      const emEdicao = editandoCliente && editandoCliente.id === c.id;
      const formInline = emEdicao ? `
        <tr class="admin-edit-row"><td colspan="7">
          <form class="admin-inline-form" data-inline-form="${esc(c.id)}" data-inline-modo="${esc(editandoCliente.modo)}">
            ${editandoCliente.modo === 'email' ? `
              <label class="ds-label" style="margin:0;">E-mail de acesso para <strong>${esc(c.nome)}</strong>:</label>
              <input type="email" name="email" class="ds-input" value="${esc(c.email || '')}" placeholder="cliente@empresa.com" required style="max-width:280px;">
              <button type="submit" class="btn btn-primary btn-sm">Salvar e enviar convite</button>
            ` : `
              <label class="ds-label" style="margin:0;">Limite mensal de envios para <strong>${esc(c.nome)}</strong> (vazio = ilimitado):</label>
              <input type="number" name="limite" class="ds-input" min="1" max="10000" value="${lim != null ? esc(lim) : ''}" placeholder="Ex: 200" style="max-width:140px;">
              <button type="submit" class="btn btn-primary btn-sm">Salvar limite</button>
            `}
            <button type="button" class="btn btn-ghost btn-sm" data-cancelar-inline>Cancelar</button>
          </form>
        </td></tr>` : '';

      return `
        <tr>
          <td>
            <div style="font-weight:600;">${esc(c.nome)} ${c.eh_admin ? '<span class="badge badge-novo" style="margin-left:4px;">Admin</span>' : ''}</div>
            <div class="ds-card-subtitle" style="margin:0;">${esc(c.email || 'Sem e-mail vinculado')}</div>
          </td>
          <td><span class="badge ${s.cls}">${s.rotulo}</span></td>
          <td>
            <strong>${u.envios_mes || 0}</strong>${lim ? ` / ${lim}` : ' <span class="ds-card-subtitle">(ilimitado)</span>'}
            ${barraUso}
          </td>
          <td>${u.lancamentos_total || 0} lidos${u.erros_fila ? ` · <span style="color:var(--c-bad-fg);">${u.erros_fila} erro${u.erros_fila > 1 ? 's' : ''}</span>` : ''}</td>
          <td>${fmtMb(u.bytes)}</td>
          <td>${fmtData(u.ultimo_envio)}</td>
          <td>
            <div class="admin-acoes">
              ${!c.email
                ? `<button type="button" class="btn btn-primary btn-sm" data-adm-editar-email="${esc(c.id)}">Vincular e-mail</button>`
                : `<button type="button" class="btn btn-secondary btn-sm" data-adm-reenviar="${esc(c.email)}">Reenviar acesso</button>`}
              <button type="button" class="btn btn-ghost btn-sm" data-adm-editar-limite="${esc(c.id)}">Limite</button>
              ${!c.eh_admin ? `<button type="button" class="btn btn-ghost btn-sm" data-adm-toggle="${esc(c.id)}" data-adm-ativo="${c.ativo ? '1' : '0'}">${c.ativo ? 'Bloquear' : 'Reativar'}</button>` : ''}
            </div>
          </td>
        </tr>${formInline}`;
    }).join('');

    raiz.innerHTML = `
      <div class="dash-head">
        <div>
          <div class="ds-card-subtitle" style="margin:0;">Administração</div>
          <h2 class="dash-h1">Usuários e Controle de Uso</h2>
          <p class="ds-card-subtitle">Convide novos clientes, gerencie acessos e acompanhe o consumo mensal de leitura da IA</p>
        </div>
      </div>

      ${dadosCache.colunas_admin_ok === false ? `
      <div class="dash-aviso-pend">
        <span>${ic('circle-alert')} Execute o arquivo <code>supabase/schema_v5_admin.sql</code> no SQL Editor do Supabase para ativar o controle de limite mensal por cliente.</span>
      </div>` : ''}

      <div class="kpi-grid">
        ${kpi('users', 'Clientes ativos', `${r.clientes_ativos || 0} / ${r.clientes_total || 0}`, 'Cadastros liberados')}
        ${kpi('upload', 'Envios neste mês', String(r.envios_mes || 0), `${r.envios_total || 0} no histórico total`)}
        ${kpi('receipt-text', 'Cupons lidos', String(r.lancamentos_total || 0), r.erros_fila ? `${r.erros_fila} em revisão manual` : 'Sem falhas pendentes')}
        ${kpi('folder-open', 'Armazenamento', fmtMb(r.bytes_total), 'Fotos compactadas no Storage')}
      </div>

      <section class="ds-card">
        <h3 class="ds-card-title dash-titulo">${ic('plus')} Convidar novo cliente</h3>
        <form id="form-admin-convidar" class="admin-convite-form">
          <div class="admin-campo">
            <label class="ds-label" for="adm-novo-nome">Nome do Buffet / Empresa</label>
            <input type="text" id="adm-novo-nome" class="ds-input" placeholder="Ex: Buffet Sabor Real" required maxlength="120">
          </div>
          <div class="admin-campo">
            <label class="ds-label" for="adm-novo-email">E-mail de acesso</label>
            <input type="email" id="adm-novo-email" class="ds-input" placeholder="contato@buffet.com" required>
          </div>
          <div class="admin-campo admin-campo--sm">
            <label class="ds-label" for="adm-novo-limite">Limite/mês (opcional)</label>
            <input type="number" id="adm-novo-limite" class="ds-input" min="1" max="10000" placeholder="Ilimitado">
          </div>
          <button type="submit" id="btn-adm-convidar" class="btn btn-primary">Enviar convite</button>
        </form>
      </section>

      <section class="ds-card">
        <div class="ds-card-header">
          <div>
            <h3 class="ds-card-title dash-titulo">${ic('shield')} Clientes e consumo</h3>
            <p class="ds-card-subtitle">Vincule e-mails, ajuste limites mensais ou bloqueie acessos a qualquer momento</p>
          </div>
          <button type="button" id="btn-adm-atualizar" class="btn btn-secondary btn-sm">${ic('refresh-cw')} Atualizar</button>
        </div>
        <div class="ds-table-wrapper">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Situação</th>
                <th>Envios (mês)</th>
                <th>Cupons lidos</th>
                <th>Espaço</th>
                <th>Último envio</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>${linhas || '<tr><td colspan="7" class="empty-state">Nenhum cliente cadastrado.</td></tr>'}</tbody>
          </table>
        </div>
      </section>`;
  }

  function ligar() {
    const raiz = document.getElementById('admin-root');
    if (!raiz || raiz.dataset.ligado) return;
    raiz.dataset.ligado = '1';

    raiz.addEventListener('submit', async (ev) => {
      if (ev.target.id === 'form-admin-convidar') {
        ev.preventDefault();
        const btn = document.getElementById('btn-adm-convidar');
        const nome = document.getElementById('adm-novo-nome').value.trim();
        const email = document.getElementById('adm-novo-email').value.trim();
        const limite = document.getElementById('adm-novo-limite').value.trim();
        btn.disabled = true;
        btn.textContent = 'Enviando…';
        try {
          await acaoAdmin({ acao: 'convidar', nome, email, limite_mensal_envios: limite === '' ? null : Number(limite) });
        } catch (err) {
          if (typeof window.toast === 'function') window.toast(err.message, 'erro');
          btn.disabled = false;
          btn.textContent = 'Enviar convite';
        }
        return;
      }

      const inline = ev.target.closest('[data-inline-form]');
      if (inline) {
        ev.preventDefault();
        const id = inline.dataset.inlineForm;
        const modo = inline.dataset.inlineModo;
        const btn = inline.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
          if (modo === 'email') {
            const email = inline.querySelector('input[name="email"]').value.trim();
            await acaoAdmin({ acao: 'convidar', cliente_id: id, email });
          } else {
            const lim = inline.querySelector('input[name="limite"]').value.trim();
            await acaoAdmin({ acao: 'atualizar_limite', cliente_id: id, limite_mensal_envios: lim === '' ? null : Number(lim) });
          }
        } catch (err) {
          if (typeof window.toast === 'function') window.toast(err.message, 'erro');
          if (btn) btn.disabled = false;
        }
      }
    });

    raiz.addEventListener('click', async (ev) => {
      if (ev.target.closest('#btn-adm-atualizar')) {
        window.carregarAdmin();
        return;
      }
      if (ev.target.closest('[data-cancelar-inline]')) {
        editandoCliente = null;
        render();
        return;
      }
      const bEmail = ev.target.closest('[data-adm-editar-email]');
      if (bEmail) {
        editandoCliente = { id: bEmail.dataset.admEditarEmail, modo: 'email' };
        render();
        return;
      }
      const bLim = ev.target.closest('[data-adm-editar-limite]');
      if (bLim) {
        editandoCliente = { id: bLim.dataset.admEditarLimite, modo: 'limite' };
        render();
        return;
      }
      const bReenv = ev.target.closest('[data-adm-reenviar]');
      if (bReenv) {
        const email = bReenv.dataset.admReenviar;
        bReenv.disabled = true;
        try {
          await acaoAdmin({ acao: 'reenviar_convite', email });
        } catch (err) {
          if (typeof window.toast === 'function') window.toast(err.message, 'erro');
          bReenv.disabled = false;
        }
        return;
      }
      const bTog = ev.target.closest('[data-adm-toggle]');
      if (bTog) {
        const id = bTog.dataset.admToggle;
        const atualmenteAtivo = bTog.dataset.admAtivo === '1';
        const sim = typeof window.confirmar === 'function'
          ? await window.confirmar({
              titulo: atualmenteAtivo ? 'Bloquear acesso deste cliente?' : 'Reativar acesso deste cliente?',
              texto: atualmenteAtivo ? 'Ele não conseguirá mais entrar nem enviar cupons até ser reativado.' : 'Ele voltará a acessar o sistema normalmente.',
              acao: atualmenteAtivo ? 'Bloquear acesso' : 'Reativar acesso'
            })
          : true;
        if (!sim) return;
        try {
          await acaoAdmin({ acao: 'alternar_ativo', cliente_id: id, ativo: !atualmenteAtivo });
        } catch (err) {
          if (typeof window.toast === 'function') window.toast(err.message, 'erro');
        }
      }
    });
  }

  window.carregarAdmin = async function () {
    const raiz = document.getElementById('admin-root');
    if (!raiz) return;
    ligar();
    try {
      const res = await fetch('/api/admin');
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo.erro || 'Sem permissão.');
      dadosCache = corpo;
      render();
    } catch (e) {
      raiz.innerHTML = `<div class="ds-card"><div class="empty-state">${esc(e.message)}</div></div>`;
    }
  };
})();
