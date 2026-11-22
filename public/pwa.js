// =============================================================================
// PWA.JS — Registra o Service Worker, gerencia o botão "Instalar app"
// (Android/Chrome nativo + orientação rápida no iPhone) e sincroniza BottomNav.
// =============================================================================
(function () {
  // 1. Registrar Service Worker (obrigatório para instalação PWA)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[PWA] Falha ao registrar Service Worker:', err);
      });
    });
  }

  // 2. Detectar modo instalado e iOS
  const emStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ehIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let eventoInstalacao = null;

  function atualizarBotaoInstalar() {
    const btn = document.getElementById('btn-instalar-pwa');
    if (!btn) return;
    if (emStandalone) {
      btn.hidden = true;
      return;
    }
    btn.hidden = !(eventoInstalacao || ehIos);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalacao = e;
    atualizarBotaoInstalar();
  });

  window.addEventListener('appinstalled', () => {
    eventoInstalacao = null;
    const btn = document.getElementById('btn-instalar-pwa');
    if (btn) btn.hidden = true;
    if (typeof window.toast === 'function') window.toast('Cupom Fácil instalado na tela inicial.');
  });

  document.addEventListener('DOMContentLoaded', () => {
    atualizarBotaoInstalar();

    const btn = document.getElementById('btn-instalar-pwa');
    if (btn) {
      btn.addEventListener('click', async () => {
        if (eventoInstalacao) {
          eventoInstalacao.prompt();
          const res = await eventoInstalacao.userChoice.catch(() => null);
          if (res && res.outcome === 'accepted') {
            eventoInstalacao = null;
            atualizarBotaoInstalar();
          }
          return;
        }
        if (ehIos && typeof window.confirmar === 'function') {
          await window.confirmar({
            titulo: 'Instalar Cupom Fácil no iPhone',
            texto: 'Toque no botão Compartilhar (quadrado com seta para cima na barra do Safari) e escolha "Adicionar à Tela de Início".',
            acao: 'Entendi'
          });
        }
      });
    }

    // 3. BottomNav mobile: aciona a mesma aba da Sidebar e mantém estado sincronizado
    document.querySelectorAll('.bottom-nav__item').forEach((item) => {
      item.addEventListener('click', () => {
        const alvo = item.dataset.tabAlvo;
        document.querySelector(`.app-sidebar .nav-tab[data-tab="${alvo}"]`)?.click();
      });
    });

    document.querySelectorAll('.app-sidebar .nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const alvo = tab.dataset.tab;
        document.querySelectorAll('.bottom-nav__item').forEach((b) => {
          const ativo = b.dataset.tabAlvo === alvo;
          b.classList.toggle('active', ativo);
          if (ativo) b.setAttribute('aria-current', 'page');
          else b.removeAttribute('aria-current');
        });
      });
    });
  });
})();
