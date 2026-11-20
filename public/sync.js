// =============================================================================
// SYNC.JS — Sincronização com Supabase, fila offline em IndexedDB
// Garante que nenhum cupom seja perdido mesmo sem conexão.
// =============================================================================

/**
 * Nome do banco IndexedDB e da object store para fila offline.
 */
const DB_NAME = 'cupom-fiscal-db';
const DB_VERSION = 1;
const STORE_NAME = 'fila-offline';

/**
 * Configurações de rede e retry.
 */
const SYNC_CONFIG = {
  TIMEOUT_MS: 30000,          // Timeout de 30 segundos por requisição
  MAX_RETRIES: 3,             // Tentativas antes de jogar no IndexedDB
  RETRY_BASE_MS: 1000,        // Base do backoff exponencial (1s)
  ENDPOINT_UPLOAD: '/api/upload-cupom' // Rota serverless na Vercel
};

// ---------------------------------------------------------------------------
// IndexedDB — Fila local para cupons que falharam ou foram capturados offline
// ---------------------------------------------------------------------------

/**
 * Abre (ou cria) o banco IndexedDB para fila offline.
 *
 * @returns {Promise<IDBDatabase>} Instância do banco aberto.
 */
function abrirBancoDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Criar/atualizar a estrutura do banco na primeira vez ou upgrade
    request.onupgradeneeded = (evento) => {
      const db = evento.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('criadoEm', 'criadoEm', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Erro ao abrir IndexedDB: ' + request.error?.message));
  });
}

/**
 * Salva um cupom na fila offline do IndexedDB.
 *
 * @param {Object} dados - Dados do cupom para salvar.
 * @param {Blob} dados.blob - Imagem comprimida.
 * @param {string} dados.cliente - Nome do cliente ('Wal Salgados' ou 'André Buffet').
 * @param {string} dados.nomeArquivo - Nome do arquivo original.
 * @param {number} dados.tamanhoOriginal - Tamanho original em bytes.
 * @param {number} dados.tamanhoComprimido - Tamanho comprimido em bytes.
 * @returns {Promise<number>} ID do registro salvo.
 */
async function salvarNaFilaOffline(dados) {
  const db = await abrirBancoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const registro = {
      blob: dados.blob,
      cliente: dados.cliente,
      nomeArquivo: dados.nomeArquivo,
      tamanhoOriginal: dados.tamanhoOriginal,
      tamanhoComprimido: dados.tamanhoComprimido,
      criadoEm: new Date().toISOString(),
      tentativas: 0,
      ultimoErro: null
    };

    const request = store.add(registro);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Erro ao salvar no IndexedDB: ' + request.error?.message));

    tx.oncomplete = () => db.close();
  });
}

/**
 * Busca todos os itens pendentes na fila offline.
 *
 * @returns {Promise<Array>} Lista de registros pendentes.
 */
async function buscarFilaOffline() {
  const db = await abrirBancoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(new Error('Erro ao ler fila offline: ' + request.error?.message));

    tx.oncomplete = () => db.close();
  });
}

/**
 * Remove um item da fila offline após envio bem-sucedido.
 *
 * @param {number} id - ID do registro no IndexedDB.
 * @returns {Promise<void>}
 */
async function removerDaFilaOffline(id) {
  const db = await abrirBancoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Erro ao remover do IndexedDB: ' + request.error?.message));

    tx.oncomplete = () => db.close();
  });
}

// ---------------------------------------------------------------------------
// Upload para o servidor — com timeout e retry
// ---------------------------------------------------------------------------

/**
 * Envia uma imagem comprimida e metadados para a API serverless.
 * Implementa timeout e retry com backoff exponencial.
 *
 * @param {Object} dados - Dados do envio.
 * @param {Blob} dados.blob - Imagem comprimida.
 * @param {string} dados.cliente - Nome do cliente.
 * @param {string} dados.nomeArquivo - Nome do arquivo.
 * @param {number} dados.tamanhoOriginal - Tamanho original em bytes.
 * @param {number} dados.tamanhoComprimido - Tamanho comprimido em bytes.
 * @param {function} [onProgresso] - Callback de progresso (opcional).
 * @returns {Promise<Object>} Resposta do servidor com ID do cupom na fila.
 * @throws {Error} Se todas as tentativas falharem.
 */
async function enviarCupom(dados, onProgresso) {
  let ultimoErro = null;

  for (let tentativa = 0; tentativa < SYNC_CONFIG.MAX_RETRIES; tentativa++) {
    try {
      // Notificar tentativa (útil para a UI mostrar "Tentativa 2 de 3...")
      if (onProgresso) {
        onProgresso({
          tipo: 'tentativa',
          tentativa: tentativa + 1,
          total: SYNC_CONFIG.MAX_RETRIES
        });
      }

      // Montar o FormData com a imagem e metadados
      const formData = new FormData();
      formData.append('imagem', dados.blob, dados.nomeArquivo || 'cupom.jpg');
      formData.append('cliente', dados.cliente);
      formData.append('tamanho_original', dados.tamanhoOriginal.toString());
      formData.append('tamanho_comprimido', dados.tamanhoComprimido.toString());
      formData.append('captured_at', new Date().toISOString());

      // Enviar com timeout usando AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_MS);

      const resposta = await fetch(SYNC_CONFIG.ENDPOINT_UPLOAD, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Se a resposta não for OK, tratar como erro de servidor
      if (!resposta.ok) {
        const textoErro = await resposta.text().catch(() => 'Erro desconhecido');
        throw new Error(`HTTP ${resposta.status}: ${textoErro}`);
      }

      // Sucesso — retornar dados do servidor
      const resultado = await resposta.json();

      if (onProgresso) {
        onProgresso({ tipo: 'sucesso', resultado });
      }

      return resultado;

    } catch (erro) {
      ultimoErro = erro;

      // Se foi o usuário que abortou, não tentar de novo
      if (erro.name === 'AbortError') {
        ultimoErro = new Error('Envio cancelado por timeout (' + SYNC_CONFIG.TIMEOUT_MS + 'ms)');
      }

      // Se não é a última tentativa, esperar com backoff exponencial + jitter
      if (tentativa < SYNC_CONFIG.MAX_RETRIES - 1) {
        const atraso = calcularBackoff(tentativa, SYNC_CONFIG.RETRY_BASE_MS);
        if (onProgresso) {
          onProgresso({
            tipo: 'retry',
            tentativa: tentativa + 1,
            proximaTentativaMs: atraso,
            erro: ultimoErro.message
          });
        }
        await aguardar(atraso);
      }
    }
  }

  // Todas as tentativas falharam — erro final
  throw ultimoErro || new Error('Falha no envio após todas as tentativas.');
}

/**
 * Tenta enviar o cupom; se falhar, salva na fila offline automaticamente.
 * Esta é a função principal que a UI deve chamar.
 *
 * @param {Object} dados - Dados do cupom (blob, cliente, nomeArquivo, tamanhos).
 * @param {function} [onProgresso] - Callback de progresso para a UI.
 * @returns {Promise<{sucesso: boolean, resultado?: Object, offlineId?: number, erro?: string}>}
 */
async function enviarOuEnfileirar(dados, onProgresso) {
  // Se está offline, salvar direto no IndexedDB
  if (!navigator.onLine) {
    if (onProgresso) {
      onProgresso({ tipo: 'offline' });
    }

    try {
      const offlineId = await salvarNaFilaOffline(dados);
      return { sucesso: false, offlineId, erro: 'Dispositivo offline. Salvo para envio posterior.' };
    } catch (erroDb) {
      return { sucesso: false, erro: 'Offline e falha ao salvar localmente: ' + erroDb.message };
    }
  }

  // Tentar enviar online
  try {
    const resultado = await enviarCupom(dados, onProgresso);
    return { sucesso: true, resultado };
  } catch (erro) {
    // Envio falhou após retries — salvar no IndexedDB
    if (onProgresso) {
      onProgresso({ tipo: 'salvando-offline', erro: erro.message });
    }

    try {
      const offlineId = await salvarNaFilaOffline(dados);
      return {
        sucesso: false,
        offlineId,
        erro: 'Falha no envio. Salvo offline para reenvio automático.'
      };
    } catch (erroDb) {
      return {
        sucesso: false,
        erro: 'Falha no envio e ao salvar offline: ' + erro.message + ' | ' + erroDb.message
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Sincronização automática — processa a fila offline quando a rede voltar
// ---------------------------------------------------------------------------

/** Flag para evitar sincronizações simultâneas */
let sincronizando = false;

/**
 * Processa todos os itens pendentes na fila offline.
 * Chamada automaticamente quando a rede reconecta.
 *
 * @param {function} [onProgresso] - Callback de progresso para a UI.
 * @returns {Promise<{enviados: number, falhas: number}>}
 */
async function sincronizarFilaOffline(onProgresso) {
  // Evitar execuções simultâneas
  if (sincronizando) return { enviados: 0, falhas: 0 };
  sincronizando = true;

  let enviados = 0;
  let falhas = 0;

  try {
    const fila = await buscarFilaOffline();

    if (fila.length === 0) {
      sincronizando = false;
      return { enviados: 0, falhas: 0 };
    }

    if (onProgresso) {
      onProgresso({ tipo: 'sync-inicio', total: fila.length });
    }

    // Processar um por um para não sobrecarregar a rede
    for (const item of fila) {
      try {
        if (onProgresso) {
          onProgresso({ tipo: 'sync-item', cliente: item.cliente, indice: enviados + falhas + 1, total: fila.length });
        }

        await enviarCupom({
          blob: item.blob,
          cliente: item.cliente,
          nomeArquivo: item.nomeArquivo,
          tamanhoOriginal: item.tamanhoOriginal,
          tamanhoComprimido: item.tamanhoComprimido
        });

        // Envio OK — remover da fila offline
        await removerDaFilaOffline(item.id);
        enviados++;

      } catch (erro) {
        // Falhou de novo — manter no IndexedDB para próxima tentativa
        falhas++;
        console.warn(`[SYNC] Falha ao reenviar cupom ${item.id}:`, erro.message);
      }
    }

    if (onProgresso) {
      onProgresso({ tipo: 'sync-fim', enviados, falhas });
    }

  } catch (erroGeral) {
    console.error('[SYNC] Erro geral na sincronização:', erroGeral);
  } finally {
    sincronizando = false;
  }

  return { enviados, falhas };
}

/**
 * Registra listeners de rede para sincronização automática.
 * Deve ser chamada uma vez na inicialização da app.
 *
 * @param {function} [onProgresso] - Callback de progresso para a UI.
 */
function iniciarMonitoramentoDeRede(onProgresso) {
  // Quando a rede voltar, tentar sincronizar
  window.addEventListener('online', async () => {
    console.log('[SYNC] Rede reconectada. Iniciando sincronização...');
    if (onProgresso) {
      onProgresso({ tipo: 'rede-online' });
    }
    await sincronizarFilaOffline(onProgresso);
  });

  // Quando perder rede, avisar a UI
  window.addEventListener('offline', () => {
    console.log('[SYNC] Rede perdida.');
    if (onProgresso) {
      onProgresso({ tipo: 'rede-offline' });
    }
  });

  // Usar a Background Sync API quando disponível (Service Worker)
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then((registration) => {
      // Registrar tag de sincronização para o SW processar em background
      registration.sync.register('sincronizar-cupons').catch(() => {
        // SyncManager não suportado ou permissão negada — ignorar silenciosamente
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/**
 * Calcula o atraso com backoff exponencial + jitter aleatório.
 * Evita thundering herd quando vários dispositivos tentam ao mesmo tempo.
 *
 * @param {number} tentativa - Número da tentativa (0, 1, 2...).
 * @param {number} baseMs - Atraso base em milissegundos.
 * @returns {number} Atraso em milissegundos.
 */
function calcularBackoff(tentativa, baseMs) {
  const atrasoExponencial = baseMs * Math.pow(2, tentativa);     // 1s, 2s, 4s, 8s...
  const jitter = Math.random() * atrasoExponencial * 0.5;        // até 50% do atraso
  return Math.min(atrasoExponencial + jitter, 30000);             // máximo 30 segundos
}

/**
 * Promise que resolve após o tempo especificado.
 *
 * @param {number} ms - Milissegundos para aguardar.
 * @returns {Promise<void>}
 */
function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
