// =============================================================================
// TEMA.JS — Alterna tema claro/escuro (ERIC Design System 1.2) via data-tema
// no <html>. Carregado no <head> para evitar flash branco no modo escuro.
// =============================================================================
(function () {
  const CHAVE = 'eric-tema';
  const html = document.documentElement;

  function aplicar(tema) {
    const t = tema === 'escuro' ? 'escuro' : 'claro';
    html.setAttribute('data-tema', t);
    try { localStorage.setItem(CHAVE, t); } catch (_) {}

    const metaCor = document.querySelector('meta[name="theme-color"]');
    if (metaCor) metaCor.setAttribute('content', t === 'escuro' ? '#161b22' : '#ffffff');
    const metaScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaScheme) metaScheme.setAttribute('content', t === 'escuro' ? 'dark' : 'light');

    sincronizarBotoes(t);
    window.dispatchEvent(new CustomEvent('eric-tema', { detail: t }));
  }

  function sincronizarBotoes(t) {
    const escuro = t === 'escuro';
    document.querySelectorAll('[data-toggle-tema]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(escuro));
      btn.setAttribute('aria-label', escuro ? 'Ativar modo claro' : 'Ativar modo escuro');
      btn.setAttribute('title', escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro');
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', escuro ? '/icons.svg#i-sun' : '/icons.svg#i-moon');
      const lbl = btn.querySelector('[data-tema-label]');
      if (lbl) lbl.textContent = escuro ? 'Claro' : 'Escuro';
    });
  }

  let salvo = null;
  try { salvo = localStorage.getItem(CHAVE); } catch (_) {}
  aplicar(salvo || 'claro');

  window.EricTema = {
    get: () => html.getAttribute('data-tema') || 'claro',
    set: aplicar,
    toggle: () => aplicar(html.getAttribute('data-tema') === 'escuro' ? 'claro' : 'escuro')
  };

  document.addEventListener('DOMContentLoaded', () => {
    sincronizarBotoes(window.EricTema.get());
    document.querySelectorAll('[data-toggle-tema]').forEach((btn) => {
      btn.addEventListener('click', () => window.EricTema.toggle());
    });
  });
})();
