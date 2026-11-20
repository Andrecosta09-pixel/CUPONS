// =============================================================================
// API/UPLOAD-CUPOM.JS — Rota serverless Vercel para receber cupons
// Recebe a imagem comprimida do PWA, salva no Supabase Storage e
// insere na fila de processamento. Responde rápido sem depender da Gemini API.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

/**
 * Configuração do Supabase com service_role_key (acesso admin).
 * As variáveis de ambiente são definidas no painel da Vercel.
 */
function criarClienteSupabase() {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    throw new Error('Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  }

  return createClient(url, chave, {
    auth: { persistSession: false }
  });
}

/**
 * Gera um slug amigável para o nome do cliente (usado como pasta no Storage).
 * "Wal Salgados" → "wal-salgados", "André Buffet" → "andre-buffet"
 *
 * @param {string} cliente - Nome do cliente.
 * @returns {string} Slug normalizado.
 */
function slugCliente(cliente) {
  return cliente
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remover acentos
    .replace(/\s+/g, '-')             // espaços → hifens
    .replace(/[^a-z0-9-]/g, '');      // remover caracteres especiais
}

/**
 * Handler principal da rota POST /api/upload-cupom
 *
 * Recebe: FormData com campos:
 *   - imagem: arquivo (Blob/File) da imagem comprimida
 *   (o cliente vem do login, não do formulário)
 *   - tamanho_original: tamanho original em bytes (string)
 *   - tamanho_comprimido: tamanho comprimido em bytes (string)
 *   - captured_at: ISO timestamp da captura (string)
 *
 * Responde: 201 com { id, mensagem } ou 4xx/5xx com { erro }
 */
export default async function handler(req, res) {
  // Aceitar apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido. Use POST.' });
  }

  try {
    // --- 0. Login: o cliente é sempre o do usuário autenticado ---
    const supabase = criarClienteSupabase();
    const clienteLogado = await autenticar(req, res, supabase);
    if (!clienteLogado) return;
    const cliente = clienteLogado.nome;

    // --- 1. Ler o FormData da requisição ---
    // Na Vercel, o body parser multipart não é automático para o runtime Node.
    // Precisamos parsear manualmente usando a API Web.
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ erro: 'Content-Type deve ser multipart/form-data.' });
    }

    // Converter o request Node.js para um Request Web API para usar formData()
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Parsear o multipart manualmente usando o boundary do Content-Type
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ erro: 'Boundary do multipart não encontrado.' });
    }

    const partes = parsearMultipart(body, boundary);

    // --- 2. Validar campos obrigatórios ---
    const tamanhoOriginal = parseInt(partes.campos['tamanho_original'] || '0', 10);
    const tamanhoComprimido = parseInt(partes.campos['tamanho_comprimido'] || '0', 10);
    const capturedAt = partes.campos['captured_at'] || new Date().toISOString();
    const arquivo = partes.arquivos['imagem'];

    if (!arquivo || !arquivo.buffer || arquivo.buffer.length === 0) {
      return res.status(400).json({ erro: 'Campo "imagem" obrigatório. Envie uma imagem comprimida.' });
    }

    // --- 3. Upload para o Supabase Storage ---
    const agora = new Date();
    const anoMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    const idUnico = crypto.randomUUID();
    const storagePath = `${slugCliente(cliente)}/${anoMes}/${idUnico}.jpg`;

    const { error: erroStorage } = await supabase.storage
      .from('cupons')
      .upload(storagePath, arquivo.buffer, {
        contentType: arquivo.mimeType || 'image/jpeg',
        upsert: false
      });

    if (erroStorage) {
      console.error('[UPLOAD] Erro no Storage:', erroStorage);
      return res.status(502).json({
        erro: 'Falha ao salvar imagem no Storage: ' + erroStorage.message
      });
    }

    // --- 4. Inserir registro na tabela cupons_fila ---
    const { data: registro, error: erroBanco } = await supabase
      .from('cupons_fila')
      .insert({
        cliente: cliente,
        storage_path: storagePath,
        mime_type: arquivo.mimeType || 'image/jpeg',
        tamanho_original_bytes: tamanhoOriginal || arquivo.buffer.length,
        tamanho_comprimido_bytes: tamanhoComprimido || arquivo.buffer.length,
        status: 'pendente',
        tentativas: 0,
        proxima_tentativa_em: null,
        ultimo_erro: null
      })
      .select('id, criado_em')
      .single();

    if (erroBanco) {
      console.error('[UPLOAD] Erro ao inserir na fila:', erroBanco);
      // Tentar remover a imagem do Storage para não deixar lixo
      await supabase.storage.from('cupons').remove([storagePath]).catch(() => {});
      return res.status(502).json({
        erro: 'Falha ao registrar cupom na fila: ' + erroBanco.message
      });
    }

    // --- 5. Responder com sucesso (rápido, sem depender da Gemini API) ---
    console.log(`[UPLOAD] Cupom registrado: id=${registro.id}, cliente=${cliente}, path=${storagePath}`);

    return res.status(201).json({
      id: registro.id,
      mensagem: 'Cupom recebido e na fila para processamento.',
      storage_path: storagePath,
      criado_em: registro.criado_em
    });

  } catch (erro) {
    console.error('[UPLOAD] Erro inesperado:', erro);
    return res.status(500).json({
      erro: 'Erro interno do servidor: ' + erro.message
    });
  }
}

// ---------------------------------------------------------------------------
// Parser multipart manual (sem dependências externas)
// ---------------------------------------------------------------------------

/**
 * Parsea um body multipart/form-data em campos de texto e arquivos.
 * Necessário porque o runtime Node.js da Vercel não parseia multipart nativamente.
 *
 * @param {Buffer} body - Body completo da requisição.
 * @param {string} boundary - Boundary do multipart.
 * @returns {{ campos: Object, arquivos: Object }} Campos e arquivos parseados.
 */
function parsearMultipart(body, boundary) {
  const campos = {};
  const arquivos = {};

  // Separar as partes pelo boundary
  const separador = Buffer.from('--' + boundary);
  const finalizador = Buffer.from('--' + boundary + '--');
  const crlf = Buffer.from('\r\n');
  const crlfDuplo = Buffer.from('\r\n\r\n');

  let posicao = 0;

  while (posicao < body.length) {
    // Encontrar o próximo boundary
    const inicioBoundary = body.indexOf(separador, posicao);
    if (inicioBoundary === -1) break;

    // Verificar se é o finalizador
    const sliceFim = body.slice(inicioBoundary, inicioBoundary + finalizador.length);
    if (sliceFim.equals(finalizador)) break;

    // Pular o boundary + CRLF
    const inicioHeaders = inicioBoundary + separador.length + crlf.length;

    // Encontrar o fim dos headers (CRLF duplo)
    const fimHeaders = body.indexOf(crlfDuplo, inicioHeaders);
    if (fimHeaders === -1) break;

    // Extrair headers da parte
    const headersTexto = body.slice(inicioHeaders, fimHeaders).toString('utf-8');
    const inicioConteudo = fimHeaders + crlfDuplo.length;

    // Encontrar o fim do conteúdo (próximo boundary)
    const proximoBoundary = body.indexOf(separador, inicioConteudo);
    const fimConteudo = proximoBoundary === -1 ? body.length : proximoBoundary - crlf.length;

    const conteudo = body.slice(inicioConteudo, fimConteudo);

    // Parsear headers para extrair nome do campo e filename
    const nomeMatch = headersTexto.match(/name="([^"]+)"/);
    const filenameMatch = headersTexto.match(/filename="([^"]+)"/);
    const contentTypeMatch = headersTexto.match(/Content-Type:\s*(.+)/i);

    if (nomeMatch) {
      const nomeCampo = nomeMatch[1];

      if (filenameMatch) {
        // É um arquivo
        arquivos[nomeCampo] = {
          nomeOriginal: filenameMatch[1],
          mimeType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
          buffer: conteudo
        };
      } else {
        // É um campo de texto
        campos[nomeCampo] = conteudo.toString('utf-8');
      }
    }

    posicao = proximoBoundary !== -1 ? proximoBoundary : body.length;
  }

  return { campos, arquivos };
}

/**
 * Configuração do runtime Vercel: desabilitar o body parser automático
 * para podermos ler o stream do multipart manualmente.
 */
export const config = {
  api: {
    bodyParser: false
  }
};
