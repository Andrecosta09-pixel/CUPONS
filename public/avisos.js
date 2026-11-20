// =============================================================================
// AVISOS.JS — Toast e Diálogo de confirmação no padrão ERIC.
// Substitui alert() e confirm() do navegador.
//   toast('Mensagem', 'ok' | 'erro' | 'info')
//   const sim = await confirmar({ titulo, texto, acao, perigo })
// =============================================================================
(function () {
  const ic = (n) => `<svg class="ic" aria-hidden="true"><use href="/icons.svg#i-${n}"/></svg>`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Toast: canto inferior, 4 s (erro fica 7 s), role="status"/"alert" ----
  function areaToast() {
    let a = document.getElementById('toast-area');
    if (!a) {
      a = document.createElement('div');
      a.id = 'toast-area';
      a.className = 'toast-area';
      document.body.appendChild(a);
    }
    return a;
  }

  window.toast = function (mensagem, tipo = 'ok') {
    const icone = tipo === 'erro' ? 'circle-alert' : (tipo === 'info' ? 'sparkles' : 'circle-check');
    const el = document.createElement('div');
    el.className = `toast toast--${tipo}`;
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = `${ic(icone)}<span class="toast__txt">${esc(mensagem)}</span>
      <button type="button" class="toast__x" aria-label="Fechar aviso">${ic('x')}</button>`;
    const remover = () => {
      if (!el.parentNode) return;
      el.classList.add('toast--sai');
      setTimeout(() => el.remove(), 160);
    };
    el.querySelector('.toast__x').addEventListener('click', remover);
    areaToast().appendChild(el);
    setTimeout(remover, tipo === 'erro' ? 7000 : 4000);
  };

  // ---- Diálogo de confirmação: foco preso, Esc cancela, devolve o foco ----
  window.confirmar = function ({ titulo, texto = '', acao = 'Confirmar', cancelar = 'Cancelar', perigo = false }) {
    return new Promise((resolve) => {
      const antes = document.activeElement;
      const veu = document.createElement('div');
      veu.className = 'modal-overlay open';
      veu.style.zIndex = '80';
      veu.innerHTML = `
        <div class="modal-content dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">
          <div class="dialogo__corpo">
            <h2 id="dlg-t" class="dialogo__titulo">${esc(titulo)}</h2>
            <p id="dlg-d" class="dialogo__texto">${esc(texto)}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-r="nao">${esc(cancelar)}</button>
            <button type="button" class="btn ${perigo ? 'btn-danger' : 'btn-primary'}" data-r="sim">${esc(acao)}</button>
          </div>
        </div>`;
      document.body.appendChild(veu);

      const nao = veu.querySelector('[data-r="nao"]');
      const sim = veu.querySelector('[data-r="sim"]');
      const fechar = (valor) => {
        document.removeEventListener('keydown', teclas, true);
        veu.remove();
        if (antes && document.contains(antes)) antes.focus();
        resolve(valor);
      };
      const teclas = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(false); }
        if (ev.key === 'Tab') {
          const f = [nao, sim];
          const i = f.indexOf(document.activeElement);
          ev.preventDefault();
          f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      };
      document.addEventListener('keydown', teclas, true);
      nao.addEventListener('click', () => fechar(false));
      sim.addEventListener('click', () => fechar(true));
      veu.addEventListener('mousedown', (ev) => { if (ev.target === veu) fechar(false); });
      sim.focus();
    });
  };
})();
