// =============================================================================
// API/_NORMALIZADOR.JS — Módulo compartilhado de normalização para Buffet:
// - 7 categorias oficiais de buffet + classificador determinístico consistente
// - Normalização de unidades (KG->kg, UN->un, LT->L) e itens canônicos
// - Normalização de estabelecimentos/filiais (CNPJ, raiz 8 dígitos, regras)
// Prefixo "_" não conta no limite de funções serverless da Vercel.
// =============================================================================

export const CATEGORIAS_BUFFET = [
  'Proteínas & Frios',
  'Mercearia & Secos',
  'Hortifruti & Padaria',
  'Embalagens & Descartáveis',
  'Limpeza & Utensílios',
  'Combustível & Logística',
  'Outros'
];

export function semAcento(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'sem', 'para', 'por', 'a', 'o']);

export function titleCasePt(texto) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  return limpo
    .split(' ')
    .map((p, i) => {
      if (p === '&') return '&';
      const low = p.toLowerCase();
      if (i > 0 && PREPOSICOES.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// 1. CNPJ e Normalização de Estabelecimentos / Filiais
// ---------------------------------------------------------------------------
export function sanitizarCnpj(valor) {
  if (!valor) return null;
  const dig = String(valor).replace(/\D/g, '');
  return dig.length === 14 ? dig : null;
}

export function raizCnpj(cnpj) {
  const limpo = sanitizarCnpj(cnpj);
  return limpo ? limpo.slice(0, 8) : null;
}

export function limparNomeEstabelecimento(nome) {
  let s = String(nome || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Não identificado';
  // Remove sufixos societários e marcadores de filial comuns em cupons fiscais
  s = s
    .replace(/\b(LTDA\.?|ME|EPP|EIRELI|S\/?A|S\.A\.|SS|SLU)\b/gi, '')
    .replace(/\b(FILIAL|LOJA|LJ|UNID\.?|UNIDADE)\s*#?\s*\d+\b/gi, '')
    .replace(/\b(COMERCIO|COM\.?)\s+DE\s+ALIMENTOS\b/gi, '')
    .replace(/\b(INDUSTRIA|IND\.?)\s+E\s+COMERCIO\b/gi, '')
    .replace(/[-–—|/]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return titleCasePt(s || nome);
}

/**
 * Resolve o Nome Canônico do estabelecimento usando regras salvas do cliente:
 * 1) CNPJ exato (14 dígitos)
 * 2) Raiz do CNPJ (8 dígitos — agrupa filiais da mesma rede automaticamente)
 * 3) Padrão de nome normalizado
 * 4) Fallback: limpeza automática do nome original
 */
export function resolverEstabelecimento(estabOriginal, cnpj, regras = []) {
  const cnpjLimpo = sanitizarCnpj(cnpj);
  const raiz = raizCnpj(cnpjLimpo);
  const nomeNorm = semAcento(limparNomeEstabelecimento(estabOriginal));

  if (Array.isArray(regras) && regras.length > 0) {
    if (cnpjLimpo) {
      const exato = regras.find((r) => r.cnpj && r.cnpj === cnpjLimpo);
      if (exato && exato.nome_canonico) return exato.nome_canonico;
    }
    if (raiz) {
      const porRaiz = regras.find((r) => r.cnpj_raiz && r.cnpj_raiz === raiz);
      if (porRaiz && porRaiz.nome_canonico) return porRaiz.nome_canonico;
    }
    if (nomeNorm) {
      const porNome = regras.find((r) => {
        if (!r.padrao_nome) return false;
        const p = semAcento(r.padrao_nome);
        return p && (nomeNorm === p || nomeNorm.includes(p) || p.includes(nomeNorm));
      });
      if (porNome && porNome.nome_canonico) return porNome.nome_canonico;
    }
  }

  return limparNomeEstabelecimento(estabOriginal);
}

// ---------------------------------------------------------------------------
// 2. Normalização de Unidades e Itens Canônicos
// ---------------------------------------------------------------------------
const MAPA_UNIDADES = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', quilo: 'kg', quilos: 'kg',
  g: 'g', gr: 'g', grs: 'g', grama: 'g', gramas: 'g',
  l: 'L', lt: 'L', lts: 'L', litro: 'L', litros: 'L',
  ml: 'ml', mls: 'ml',
  un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un', pc: 'un', pca: 'un', peca: 'un',
  pct: 'pct', pac: 'pct', pacote: 'pct', pacotes: 'pct',
  cx: 'cx', cxs: 'cx', caixa: 'cx', caixas: 'cx',
  fd: 'fd', fardo: 'fd', fardos: 'fd',
  bd: 'bdj', bdj: 'bdj', bandeja: 'bdj', bandejas: 'bdj',
  dz: 'dz', duzia: 'dz',
  rl: 'rl', rolo: 'rl', rolos: 'rl',
  sc: 'sc', saco: 'sc', sacos: 'sc'
};

export function normalizarUnidade(u) {
  const k = semAcento(u).replace(/[^a-z]/g, '');
  return MAPA_UNIDADES[k] || 'un';
}

const EXPANSOES_ITEM = [
  [/\bqjo\.?\b/gi, 'Queijo'],
  [/\bqueij\.?\b/gi, 'Queijo'],
  [/\bmuss\.?\b/gi, 'Mussarela'],
  [/\bmussar\.?\b/gi, 'Mussarela'],
  [/\bpres\.?\b/gi, 'Presunto'],
  [/\bpresun\.?\b/gi, 'Presunto'],
  [/\bfrang\.?\b/gi, 'Frango'],
  [/\bfrg\.?\b/gi, 'Frango'],
  [/\bcalabr\.?\b/gi, 'Calabresa'],
  [/\brefri\.?\b/gi, 'Refrigerante'],
  [/\brefrig\.?\b/gi, 'Refrigerante'],
  [/\bfar\.?\b/gi, 'Farinha'],
  [/\bacuc\.?\b/gi, 'Açúcar'],
  [/\bmarg\.?\b/gi, 'Margarina'],
  [/\bmanteig\.?\b/gi, 'Manteiga'],
  [/\bdeterg\.?\b/gi, 'Detergente'],
  [/\bdescart\.?\b/gi, 'Descartável'],
  [/\bembal\.?\b/gi, 'Embalagem'],
  [/\bfat\.?\b/gi, 'Fatiado'],
  [/\bcond\.?\b/gi, 'Condensado'],
  [/\bcr\.?\s+leite\b/gi, 'Creme de Leite']
];

export function normalizarNomeItem(nome) {
  let s = String(nome || '').trim();
  if (!s) return '';
  // Remove códigos numéricos iniciais (EAN/código interno) e excesso de pontuação
  s = s.replace(/^\d{3,}\s*[-–—]?\s*/, '').replace(/\s+/g, ' ').trim();
  for (const [rx, rep] of EXPANSOES_ITEM) {
    s = s.replace(rx, rep);
  }
  return titleCasePt(s).slice(0, 140);
}

export function normalizarItens(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((it) => {
      if (!it || typeof it !== 'object') return null;
      const nomeOriginal = typeof it.nome === 'string' ? it.nome.trim().slice(0, 140) : '';
      if (!nomeOriginal) return null;
      const nomeCanonico = normalizarNomeItem(it.nome_canonico || nomeOriginal);
      if (!nomeCanonico) return null;

      const num = (v) => {
        if (typeof v === 'number' && !isNaN(v)) return v;
        if (typeof v === 'string') {
          const limpo = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
          const p = parseFloat(limpo);
          return isNaN(p) ? null : p;
        }
        return null;
      };

      const qtd = num(it.quantidade);
      const unit = num(it.valor_unitario);
      const tot = num(it.valor_total);
      const unidade = normalizarUnidade(it.unidade);
      const qtdFinal = qtd !== null && qtd > 0 ? Number(qtd.toFixed(3)) : 1;
      const totFinal = tot !== null && tot >= 0 ? Number(tot.toFixed(2)) : (unit !== null ? Number((unit * qtdFinal).toFixed(2)) : 0);
      const unitFinal = unit !== null && unit >= 0 ? Number(unit.toFixed(2)) : (qtdFinal > 0 && totFinal > 0 ? Number((totFinal / qtdFinal).toFixed(2)) : null);

      return {
        nome: nomeCanonico,
        nome_canonico: nomeCanonico,
        nome_original: nomeOriginal,
        quantidade: qtdFinal,
        unidade,
        valor_unitario: unitFinal,
        valor_total: totFinal
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 3. Categorias Oficiais de Buffet (consistência determinística)
// ---------------------------------------------------------------------------
const REGRAS_CATEGORIA = [
  {
    categoria: 'Combustível & Logística',
    palavras: ['gasolina', 'etanol', 'diesel', 'combustivel', 'abastec', 'posto ', 'auto posto', 'gnv', 'pedagio', 'estacionamento', 'frete', 'uber', 'entrega']
  },
  {
    categoria: 'Embalagens & Descartáveis',
    palavras: ['embalag', 'descartav', 'copo ', 'copos', 'prato desc', 'talher', 'garfo', 'faca desc', 'guardanapo', 'papel toalha', 'papel aluminio', 'filme pvc', 'marmita', 'marmitex', 'bandeja', 'caixa p/', 'caixa bolo', 'sacola', 'saco plast', 'bobina', 'forminha', 'canudo', 'pote desc', 'tampa ']
  },
  {
    categoria: 'Limpeza & Utensílios',
    palavras: ['detergente', 'sabao', 'agua sanitaria', 'cloro', 'desinfetante', 'esponja', 'bucha', 'saco de lixo', 'saco lixo', 'alvejante', 'multiuso', 'alcool 70', 'alcool gel', 'luva ', 'touca', 'vassoura', 'rodo', 'pano ', 'papel higienico', 'limpa ', 'utensilio', 'assadeira', 'panela']
  },
  {
    categoria: 'Proteínas & Frios',
    palavras: ['frango', 'peito de frango', 'file ', 'carne', 'bovino', 'acem', 'patinho', 'alcatra', 'maminha', 'picanha', 'costela', 'moida', 'suino', 'lombo', 'pernil', 'bacon', 'calabresa', 'linguica', 'salsicha', 'presunto', 'apresuntado', 'peito de peru', 'queijo', 'mussarela', 'prato ', 'parmesao', 'provolone', 'requeijao', 'catupiry', 'cheddar', 'ricota', 'cream cheese', 'salmao', 'peixe', 'camarao', 'atum', 'sardinha', 'ovo ', 'ovos', 'manteiga', 'nata', 'frios', 'acougue', 'frigorifico']
  },
  {
    categoria: 'Hortifruti & Padaria',
    palavras: ['tomate', 'cebola', 'alho', 'batata', 'cenoura', 'alface', 'rucula', 'cheiro verde', 'salsinha', 'cebolinha', 'coentro', 'pimentao', 'limao', 'laranja', 'banana', 'maca', 'morango', 'uva', 'abacaxi', 'manga', 'melancia', 'mamao', 'pepino', 'brocolis', 'couve', 'abobrinha', 'berinjela', 'mandioca', 'hortifruti', 'sacolao', 'verdura', 'legume', 'fruta', 'pao ', 'paes', 'pao de forma', 'bisnaguinha', 'padaria', 'bolo ', 'torta', 'massa folhada']
  },
  {
    categoria: 'Mercearia & Secos',
    palavras: ['farinha', 'trigo', 'acucar', 'oleo', 'azeite', 'sal ', 'arroz', 'feijao', 'macarrao', 'massa ', 'molho', 'extrato', 'ketchup', 'mostarda', 'maionese', 'milho', 'ervilha', 'azeitona', 'palmito', 'leite', 'leite condensado', 'creme de leite', 'chocolate', 'cacau', 'fermento', 'amido', 'maizena', 'margarina', 'gordura', 'fuba', 'polvilho', 'tempero', 'oregano', 'pimenta', 'vinagre', 'cafe', 'refrigerante', 'suco', 'agua mineral', 'bebida', 'cerveja', 'gelo', 'biscoito', 'bolacha']
  }
];

function inferirCategoriaTexto(texto) {
  const t = ' ' + semAcento(texto) + ' ';
  for (const r of REGRAS_CATEGORIA) {
    if (r.palavras.some((p) => t.includes(p))) return r.categoria;
  }
  return null;
}

export function normalizarCategoriaBuffet(categoriaIa, itens = [], estabelecimento = '') {
  const catNorm = semAcento(categoriaIa);

  // 1. Match direto com as 7 categorias oficiais
  for (const oficial of CATEGORIAS_BUFFET) {
    if (semAcento(oficial) === catNorm) {
      if (oficial !== 'Outros') return oficial;
    }
  }

  // 2. Sinônimos de categorias antigas
  const mapaAntigo = {
    frios: 'Proteínas & Frios',
    carnes: 'Proteínas & Frios',
    proteinas: 'Proteínas & Frios',
    acougue: 'Proteínas & Frios',
    embalagens: 'Embalagens & Descartáveis',
    descartaveis: 'Embalagens & Descartáveis',
    'material de limpeza': 'Limpeza & Utensílios',
    limpeza: 'Limpeza & Utensílios',
    combustivel: 'Combustível & Logística',
    hortifruti: 'Hortifruti & Padaria',
    padaria: 'Hortifruti & Padaria',
    ingredientes: 'Mercearia & Secos',
    mercearia: 'Mercearia & Secos',
    bebidas: 'Mercearia & Secos'
  };
  if (mapaAntigo[catNorm]) return mapaAntigo[catNorm];

  // 3. Classificação determinística pelos itens (ponderada pelo valor de cada item)
  if (Array.isArray(itens) && itens.length > 0) {
    const pesos = {};
    for (const it of itens) {
      const c = inferirCategoriaTexto(it.nome_canonico || it.nome);
      if (c) {
        pesos[c] = (pesos[c] || 0) + (Number(it.valor_total) || 1);
      }
    }
    const vencedora = Object.entries(pesos).sort((a, b) => b[1] - a[1])[0];
    if (vencedora) return vencedora[0];
  }

  // 4. Fallback pelo nome do estabelecimento (ex.: posto de combustível, casa de embalagens)
  const porEstab = inferirCategoriaTexto(estabelecimento);
  if (porEstab) return porEstab;

  return 'Outros';
}
