// =============================================================================
// SW.JS — Service Worker para PWA instalável
// Cache de ativos estáticos e suporte offline.
// =============================================================================

/**
 * Nome e versão do cache. Incrementar a versão força atualização.
 */
const CACHE_NAME = 'cupom-fiscal-v10';

/**
 * Arquivos estáticos para cache (shell da aplicação).
 * São cacheados na instalação do SW para funcionamento offline.
 */
const ARQUIVOS_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/icons.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/tema.js',
  '/pwa.js',
  '/avisos.js',
  '/auth.js',
  '/dashboard.js',
  '/admin.js',
  '/compressor.js',
  '/sync.js',
  '/app.js',
  '/manifest.json'
];

// ---------------------------------------------------------------------------
// Evento: install — cachear shell da aplicação
// ---------------------------------------------------------------------------
self.addEventListener('install', (evento) => {
  console.log('[SW] Instalando Service Worker...');

  evento.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cacheando arquivos estáticos...');
        return cache.addAll(ARQUIVOS_CACHE);
      })
      .then(() => {
        // Ativar imediatamente sem esperar abas antigas fecharem
        return self.skipWaiting();
      })
      .catch((erro) => {
        console.error('[SW] Erro ao cachear:', erro);
      })
  );
});

// ---------------------------------------------------------------------------
// Evento: activate — limpar caches antigos
// ---------------------------------------------------------------------------
self.addEventListener('activate', (evento) => {
  console.log('[SW] Ativando Service Worker...');

  evento.waitUntil(
    caches.keys()
      .then((nomes) => {
        // Remover caches de versões anteriores
        return Promise.all(
          nomes
            .filter((nome) => nome !== CACHE_NAME)
            .map((nome) => {
              console.log('[SW] Removendo cache antigo:', nome);
              return caches.delete(nome);
            })
        );
      })
      .then(() => {
        // Tomar controle de todas as abas abertas imediatamente
        return self.clients.claim();
      })
  );
});

// ---------------------------------------------------------------------------
// Evento: fetch — estratégia Network First com fallback para cache
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Requisições para a API não devem ser cacheadas
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  evento.respondWith(
    // Tentar buscar da rede primeiro
    fetch(evento.request)
      .then((resposta) => {
        // Se obteve resposta válida, atualizar o cache
        if (resposta && resposta.status === 200 && resposta.type === 'basic') {
          const respostaClone = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(evento.request, respostaClone);
          });
        }
        return resposta;
      })
      .catch(() => {
        // Rede falhou — buscar do cache
        return caches.match(evento.request).then((respostaCacheada) => {
          if (respostaCacheada) {
            return respostaCacheada;
          }
          // Se não está no cache, retornar a página principal (SPA fallback)
          if (evento.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});

// ---------------------------------------------------------------------------
// Evento: sync — Background Sync para reenviar cupons pendentes
// ---------------------------------------------------------------------------
self.addEventListener('sync', (evento) => {
  if (evento.tag === 'sincronizar-cupons') {
    console.log('[SW] Background Sync: sincronizando cupons pendentes...');

    evento.waitUntil(
      // Notificar a página principal para processar a fila
      self.clients.matchAll().then((clientes) => {
        clientes.forEach((cliente) => {
          cliente.postMessage({ tipo: 'sincronizar-cupons' });
        });
      })
    );
  }
});

// ---------------------------------------------------------------------------
// Evento: message — receber mensagens da página principal
// ---------------------------------------------------------------------------
self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'skip-waiting') {
    self.skipWaiting();
  }
});
