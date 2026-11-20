// =============================================================================
// COMPRESSOR.JS — Regras de Importação de Imagem (Item 2 do Backlog)
// Limita a até 5 imagens por envio, garante tamanho final <= 10 MB,
// e realiza compressão iterativa com análise de dimensões.
// =============================================================================

const REGRAS_IMAGEM = {
  MAX_ARQUIVOS: 5,               // Máximo 5 imagens por envio
  TAMANHO_MAX_BYTES: 10 * 1024 * 1024, // 10 MB limite final
  LADO_MAIOR_MAX: 2560,          // Limite para fotos > 10 MB
  QUALIDADE_INICIAL: 0.85,       // Qualidade inicial
  PASSO_REDUCAO: 0.08,           // Passo de degradação progressiva
  QUALIDADE_MINIMA: 0.45,        // Limite mínimo aceitável para leitura de OCR
  MAX_TENTATIVAS: 6
};

/**
 * Valida a lista de arquivos selecionados antes do processamento.
 *
 * @param {FileList|Array<File>} arquivosNovos - Arquivos recém-selecionados.
 * @param {number} totalJaAdicionados - Imagens que já estão na lista atual.
 * @returns {{ valido: boolean, erro?: string }}
 */
function validarLimiteQuantidade(arquivosNovos, totalJaAdicionados = 0) {
  const total = totalJaAdicionados + arquivosNovos.length;
  if (total > REGRAS_IMAGEM.MAX_ARQUIVOS) {
    return {
      valido: false,
      erro: `Limite excedido: máximo de ${REGRAS_IMAGEM.MAX_ARQUIVOS} imagens por envio. Você já tem ${totalJaAdicionados} e tentou adicionar mais ${arquivosNovos.length}.`
    };
  }
  return { valido: true };
}

/**
 * Comprime e otimiza uma imagem individualmente conforme as regras do item 2.
 * Se a imagem for <= 10 MB e não for excessivamente grande, apenas ajusta se necessário.
 * Se for > 10 MB, aplica o loop de redimensionamento e redução progressiva.
 *
 * @param {File|Blob} arquivoOriginal - Imagem capturada ou selecionada.
 * @param {function} [onProgresso] - Callback com texto de status ("Otimizando imagem...", etc).
 * @returns {Promise<{
 *   blob: Blob,
 *   tamanhoOriginal: number,
 *   tamanhoComprimido: number,
 *   larguraOriginal: number,
 *   alturaOriginal: number,
 *   larguraFinal: number,
 *   alturaFinal: number,
 *   urlPreview: string,
 *   reducaoPercentual: number,
 *   iteracoes: number
 * }>}
 */
async function otimizarImagem(arquivoOriginal, onProgresso) {
  if (!arquivoOriginal || !(arquivoOriginal instanceof Blob)) {
    throw new Error('Arquivo de imagem inválido.');
  }

  const tamanhoOriginal = arquivoOriginal.size;
  if (onProgresso) onProgresso('Lendo arquivo e dimensões...');

  // 1. Carregar elemento de imagem
  const img = await carregarImagem(arquivoOriginal);
  const larguraOriginal = img.naturalWidth || img.width;
  const alturaOriginal = img.naturalHeight || img.height;

  // Se a imagem já tiver menos de 10 MB e dimensões aceitáveis, podemos apenas garantir JPEG otimizado
  let qualidadeAtual = REGRAS_IMAGEM.QUALIDADE_INICIAL;
  let larguraAlvo = larguraOriginal;
  let alturaAlvo = alturaOriginal;

  // Se o lado maior for maior que 2560px, redimensionar proporcionalmente
  const ladoMaior = Math.max(larguraOriginal, alturaOriginal);
  if (ladoMaior > REGRAS_IMAGEM.LADO_MAIOR_MAX) {
    const proporcao = REGRAS_IMAGEM.LADO_MAIOR_MAX / ladoMaior;
    larguraAlvo = Math.round(larguraOriginal * proporcao);
    alturaAlvo = Math.round(alturaOriginal * proporcao);
  }

  // 2. Loop de compressão progressiva
  let blobFinal = null;
  let iteracoes = 0;

  for (let i = 0; i < REGRAS_IMAGEM.MAX_TENTATIVAS; i++) {
    iteracoes++;
    if (onProgresso) {
      onProgresso(`Otimizando imagem... (passo ${iteracoes})`);
    }

    const canvas = document.createElement('canvas');
    canvas.width = larguraAlvo;
    canvas.height = alturaAlvo;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, larguraAlvo, alturaAlvo);

    blobFinal = await canvasParaBlob(canvas, 'image/jpeg', qualidadeAtual);

    // Se o tamanho ficou abaixo do limite de 10 MB, está aprovado!
    if (blobFinal.size <= REGRAS_IMAGEM.TAMANHO_MAX_BYTES) {
      break;
    }

    // Se ainda for maior que 10 MB, reduzir a qualidade e se necessário 10% das dimensões
    qualidadeAtual = Math.max(qualidadeAtual - REGRAS_IMAGEM.PASSO_REDUCAO, REGRAS_IMAGEM.QUALIDADE_MINIMA);
    larguraAlvo = Math.round(larguraAlvo * 0.9);
    alturaAlvo = Math.round(alturaAlvo * 0.9);
  }

  // 3. Validação final pós-tentativas
  if (!blobFinal || blobFinal.size > REGRAS_IMAGEM.TAMANHO_MAX_BYTES) {
    throw new Error(`Não foi possível compactar a imagem para menos de 10 MB após ${iteracoes} tentativas. O arquivo original possui densidade excessiva.`);
  }

  const tamanhoComprimido = blobFinal.size;
  const reducaoPercentual = Math.round((1 - (tamanhoComprimido / tamanhoOriginal)) * 100);
  const urlPreview = URL.createObjectURL(blobFinal);

  // Liberar imagem
  img.src = '';

  return {
    blob: blobFinal,
    tamanhoOriginal,
    tamanhoComprimido,
    larguraOriginal,
    alturaOriginal,
    larguraFinal: larguraAlvo,
    alturaFinal: alturaAlvo,
    urlPreview,
    reducaoPercentual,
    iteracoes
  };
}

function carregarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao ler o formato da imagem. Verifique se é uma imagem válida.'));
    };
    img.src = url;
  });
}

function canvasParaBlob(canvas, tipo, qualidade) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao converter canvas para Blob.'));
      },
      tipo,
      qualidade
    );
  });
}

function formatarBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
