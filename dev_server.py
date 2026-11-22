# -*- coding: utf-8 -*-
"""
DEV_SERVER.PY — Servidor Completo Alinhado ao Backlog North Stack
Implementa API de Clientes reais, Categorias, Upload em Lote,
Processamento em Tempo Real com IA, Novas Entradas e Dashboard.
"""

import os
import sys
import json
import uuid
import datetime
import mimetypes
import re
import threading
import time
import base64
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import urllib.parse

from config_local import SUPABASE_URL, SUPABASE_KEY, GEMINI_KEY, SUPABASE_ANON_KEY

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

HEADERS_SUPABASE = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def slug_cliente(nome):
    slug = nome.lower().replace(" ", "-")
    slug = re.sub(r"[áàãâä]", "a", slug)
    slug = re.sub(r"[éèêë]", "e", slug)
    slug = re.sub(r"[íìîï]", "i", slug)
    slug = re.sub(r"[óòõôö]", "o", slug)
    slug = re.sub(r"[úùûü]", "u", slug)
    slug = re.sub(r"[ç]", "c", slug)
    return re.sub(r"[^a-z0-9-]", "", slug)

def sanitizar_data(d_str):
    if not d_str or not isinstance(d_str, str): return None
    d_str = d_str.strip()
    # Se vier YYYY-MM-DD
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', d_str)
    if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # Se vier DD/MM/YYYY
    m = re.match(r'^(\d{2})/(\d{2})/(\d{4})', d_str)
    if m: return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None

def processar_lote_com_ia(cupom_id, storage_path, cliente_nome):
    """Worker background que chama a Gemini API e grava as novas entradas."""
    print(f"\n[IA WORKER] Iniciando análise de {storage_path} ({cliente_nome})...")
    try:
        # Baixar do Storage
        st_url = f"{SUPABASE_URL}/storage/v1/object/cupons/{storage_path}"
        req_img = urllib.request.Request(st_url, headers={"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY})
        with urllib.request.urlopen(req_img, timeout=25) as r_img:
            img_b64 = base64.b64encode(r_img.read()).decode("utf-8")

        prompt = """Você é um especialista em OCR e leitura de cupons e notas fiscais brasileiros.
Analise a imagem com atenção. Se houver mais de um cupom ou nota na mesma foto, retorne uma LISTA de objetos JSON.
Para cada cupom identificado, extraia estritamente:
{
  "valor_total": 0.00,
  "data_emissao": "YYYY-MM-DD",
  "estabelecimento": "Nome Fantasia ou Razão Social",
  "cnpj": "somente 14 digitos numéricos",
  "resumo_itens": "resumo dos itens principais (ex: Frutas, Carnes, Pão, Material)",
  "forma_pagamento": "dinheiro, cartao, pix, etc.",
  "categoria": "Proteínas & Frios, Mercearia & Secos, Hortifruti & Padaria, Embalagens & Descartáveis, Limpeza & Utensílios, Combustível & Logística, ou Outros",
  "confianca": "alta, media, ou baixa",
  "itens": [
    { "nome": "nome legível do produto", "quantidade": 1, "unidade": "un, kg, L, pct, cx", "valor_unitario": 0.00, "valor_total": 0.00 }
  ]
}
Extraia TODOS os itens visíveis do cupom no array "itens". Retorne SEMPRE um array JSON puro [ { ... } ]. Sem markdown nem comentários."""

        modelos = ["gemini-3.5-flash-lite", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.8-flash"]
        dados_lista = None

        for modelo in modelos:
            for tentativa in range(3):
                try:
                    url_gem = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={GEMINI_KEY}"
                    payload = {
                        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}}]}],
                        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
                    }
                    req_g = urllib.request.Request(url_gem, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
                    with urllib.request.urlopen(req_g, timeout=50) as r_g:
                        res = json.loads(r_g.read().decode())
                        texto = res["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = json.loads(texto)
                        if isinstance(parsed, dict):
                            dados_lista = [parsed]
                        elif isinstance(parsed, list):
                            dados_lista = parsed
                        print(f"[IA WORKER] ✅ Extração bem sucedida com {modelo}: {len(dados_lista)} comprovante(s) lido(s).")
                        break
                except Exception as e:
                    detalhe = e.read().decode("utf-8", errors="ignore")[:200] if isinstance(e, urllib.error.HTTPError) else str(e)
                    print(f"[IA WORKER] {modelo} tentativa {tentativa+1} falhou: {detalhe}")
                    time.sleep(2)
            if dados_lista:
                break

        if not dados_lista:
            raise Exception("Falha ao ler o cupom com os modelos de IA.")

        # Gravar entradas na tabela cupons_lancamentos com sanitização rigorosa
        for c in dados_lista:
            conf = str(c.get("confianca", "alta")).lower()
            if conf not in ["alta", "media", "baixa"]: conf = "alta"
            status_rev = "revisar" if conf == "baixa" else "novo"

            cnpj_limpo = re.sub(r"\D", "", str(c.get("cnpj", "")))[:14]
            data_valida = sanitizar_data(c.get("data_emissao"))

            try:
                val_total = float(c.get("valor_total") or 0.0)
            except:
                val_total = 0.0

            payload_lanc = {
                "cupom_id": cupom_id,
                "cliente": cliente_nome,
                "data_emissao": data_valida,
                "estabelecimento": str(c.get("estabelecimento") or "Não identificado")[:200],
                "cnpj": cnpj_limpo if len(cnpj_limpo) >= 8 else None,
                "valor_total": val_total,
                "forma_pagamento": str(c.get("forma_pagamento") or "Outros")[:50],
                "categoria": str(c.get("categoria") or "Outros")[:50],
                "resumo_itens": str(c.get("resumo_itens") or "")[:400],
                "confianca": conf,
                "status_revisao": status_rev,
                "dados_brutos_json": c
            }
            req_ins = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_lancamentos", data=json.dumps(payload_lanc).encode(), headers=HEADERS_SUPABASE, method="POST")
            try:
                with urllib.request.urlopen(req_ins):
                    pass
            except urllib.error.HTTPError as e_ins:
                msg_banco = e_ins.read().decode("utf-8", errors="ignore")
                print(f"[IA WORKER ERRO BANCO] HTTP {e_ins.code}: {msg_banco}")
                raise Exception(f"Erro Supabase: {msg_banco}")

        # Atualizar fila para processado
        req_up = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{cupom_id}", data=json.dumps({"status": "processado", "ultimo_erro": None}).encode(), headers=HEADERS_SUPABASE, method="PATCH")
        with urllib.request.urlopen(req_up):
            pass

        print(f"[IA WORKER] ✅ {len(dados_lista)} lançamento(s) gravado(s) com sucesso!\n")

    except Exception as e:
        print(f"[IA WORKER ERRO] {e}\n")
        try:
            req_up = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{cupom_id}", data=json.dumps({"status": "revisao_manual", "ultimo_erro": str(e)[:300]}).encode(), headers=HEADERS_SUPABASE, method="PATCH")
            with urllib.request.urlopen(req_up):
                pass
        except:
            pass


# ---------------------------------------------------------------------------
# Autenticação: o navegador entra pelo Supabase Auth e manda o token em
# "Authorization: Bearer". Aqui o token é validado e o cliente é achado pelo
# e-mail (tabela clientes). Cada usuário só enxerga os dados do próprio cliente.
# ---------------------------------------------------------------------------
_CACHE_SESSAO = {}  # token -> (expira_em, cliente)

def cliente_do_token(token):
    """Retorna (cliente, erro). erro = (status, mensagem) ou None."""
    agora = time.time()
    em_cache = _CACHE_SESSAO.get(token)
    if em_cache and em_cache[0] > agora:
        return em_cache[1], None
    try:
        req = urllib.request.Request(f"{SUPABASE_URL}/auth/v1/user", headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            usuario = json.loads(r.read().decode())
    except urllib.error.HTTPError:
        return None, (401, "Sessão inválida ou expirada. Entre de novo.")
    except Exception:
        return None, (503, "Não foi possível validar o login agora. Tente de novo.")

    email = str(usuario.get("email") or "").strip().lower()
    if not email or not usuario.get("email_confirmed_at"):
        return None, (401, "E-mail ainda não confirmado.")
    try:
        req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/clientes?email=eq.{urllib.parse.quote(email)}&ativo=eq.true&select=id,nome,email", headers=HEADERS_SUPABASE)
        with urllib.request.urlopen(req, timeout=10) as r:
            achados = json.loads(r.read().decode())
    except Exception:
        return None, (503, "Não foi possível consultar o cadastro agora. Tente de novo.")
    if not achados:
        return None, (403, "Seu acesso ainda não foi liberado. Fale com o administrador.")
    cliente = achados[0]
    _CACHE_SESSAO[token] = (agora + 60, cliente)
    return cliente, None

def filtro_cliente(cliente):
    return "cliente=eq." + urllib.parse.quote(cliente["nome"])

class DevHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PATCH, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def autenticar(self):
        """Valida o login desta requisição. Responde 401/403 e devolve None se não puder seguir."""
        cab = self.headers.get("Authorization", "")
        if not cab.startswith("Bearer ") or len(cab) < 20:
            self.responder_json(401, {"erro": "Entre para continuar."})
            return None
        cliente, erro = cliente_do_token(cab[7:].strip())
        if erro:
            self.responder_json(erro[0], {"erro": erro[1]})
            return None
        return cliente

    def responder_json(self, status_code, dados):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(dados, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        url_path = self.path.split("?")[0]

        # Configuração pública para o login (URL e chave anon são públicas por natureza)
        if url_path == "/api/config":
            self.responder_json(200, {"supabaseUrl": SUPABASE_URL, "anonKey": SUPABASE_ANON_KEY})
            return

        # Tudo em /api/ exige login; o cliente vem do usuário, nunca do navegador
        cliente_logado = None
        if url_path.startswith("/api/"):
            cliente_logado = self.autenticar()
            if not cliente_logado:
                return

        # 1. Quem sou eu (cliente do usuário logado)
        if url_path == "/api/eu":
            self.responder_json(200, {"nome": cliente_logado["nome"], "email": cliente_logado["email"]})
            return

        # 2. Categorias (Item 5.2)
        if url_path == "/api/categorias":
            try:
                req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/categorias?order=nome.asc", headers=HEADERS_SUPABASE)
                with urllib.request.urlopen(req) as resp:
                    cats = json.loads(resp.read().decode())
                self.responder_json(200, cats)
            except:
                self.responder_json(200, [
                    {"nome": "Mercado", "icone": "🛒"},
                    {"nome": "Obra / construção", "icone": "🔨"},
                    {"nome": "Combustível", "icone": "⛽"},
                    {"nome": "Alimentação", "icone": "🍽️"},
                    {"nome": "Farmácia / saúde", "icone": "💊"},
                    {"nome": "Casa / utilidades", "icone": "🏠"},
                    {"nome": "Serviços", "icone": "🛠️"},
                    {"nome": "Outros", "icone": "📦"}
                ])
            return

        # 3. Novas Entradas (Item 5.3)
        if url_path == "/api/novas-entradas":
            try:
                # Buscar lançamentos com status novo ou revisar
                url = f"{SUPABASE_URL}/rest/v1/cupons_lancamentos?{filtro_cliente(cliente_logado)}&order=criado_em.desc&limit=1000"
                req = urllib.request.Request(url, headers=HEADERS_SUPABASE)
                with urllib.request.urlopen(req) as resp:
                    itens = json.loads(resp.read().decode())
                self.responder_json(200, itens)
            except Exception as e:
                self.responder_json(500, {"erro": str(e)})
            return

        # 4. Fila de Processamento (Item 4)
        if url_path == "/api/processamento-fila":
            try:
                url = f"{SUPABASE_URL}/rest/v1/cupons_fila?{filtro_cliente(cliente_logado)}&order=criado_em.desc&limit=200"
                req = urllib.request.Request(url, headers=HEADERS_SUPABASE)
                with urllib.request.urlopen(req) as resp:
                    fila = json.loads(resp.read().decode())
                self.responder_json(200, fila)
            except Exception as e:
                self.responder_json(500, {"erro": str(e)})
            return

        # 4.1 Imagem Segura do Storage (privado)
        if url_path == "/api/imagem-cupom":
            params = urllib.parse.parse_qs(self.path.split("?")[1] if "?" in self.path else "")
            caminho = params.get("path", [""])[0]
            # Só imagens da pasta do próprio cliente
            if not caminho or ".." in caminho or not caminho.startswith(slug_cliente(cliente_logado["nome"]) + "/"):
                self.send_response(404)
                self.end_headers()
                return
            try:
                st_url = f"{SUPABASE_URL}/storage/v1/object/cupons/{caminho}"
                req_st = urllib.request.Request(st_url, headers={"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY})
                with urllib.request.urlopen(req_st, timeout=15) as r_st:
                    img_bytes = r_st.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                self.wfile.write(img_bytes)
            except Exception as e:
                self.send_response(404)
                self.end_headers()
            return

        # 5. Dashboard Stats (Item 5.4)
        if url_path == "/api/dashboard-stats":
            try:
                url = f"{SUPABASE_URL}/rest/v1/cupons_lancamentos?{filtro_cliente(cliente_logado)}&order=criado_em.desc"
                req = urllib.request.Request(url, headers=HEADERS_SUPABASE)
                with urllib.request.urlopen(req) as resp:
                    todos = json.loads(resp.read().decode())

                total_reais = sum([float(x.get("valor_total") or 0) for x in todos])
                qtd = len(todos)
                ticket_medio = (total_reais / qtd) if qtd > 0 else 0
                pendentes_rev = sum([1 for x in todos if x.get("status_revisao") != "confirmado"])

                # Por categoria
                cats_map = {}
                for x in todos:
                    c = x.get("categoria") or "Outros"
                    v = float(x.get("valor_total") or 0)
                    cats_map[c] = cats_map.get(c, 0) + v

                # Top estabelecimentos
                estab_map = {}
                for x in todos:
                    e = x.get("estabelecimento") or "Não identificado"
                    v = float(x.get("valor_total") or 0)
                    estab_map[e] = estab_map.get(e, 0) + v

                top_estab = sorted([{"nome": k, "total": v} for k, v in estab_map.items()], key=lambda i: i["total"], reverse=True)[:5]

                self.responder_json(200, {
                    "total_periodo": total_reais,
                    "qtd_comprovantes": qtd,
                    "ticket_medio": ticket_medio,
                    "pendentes_revisao": pendentes_rev,
                    "gastos_categoria": [{"categoria": k, "total": v} for k, v in cats_map.items()],
                    "top_estabelecimentos": top_estab
                })
            except Exception as e:
                self.responder_json(500, {"erro": str(e)})
            return

        # Arquivos Estáticos de public/
        if url_path == "/" or url_path == "":
            url_path = "/index.html"

        file_path = os.path.join(PUBLIC_DIR, url_path.lstrip("/"))

        if os.path.exists(file_path) and os.path.isfile(file_path):
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type: mime_type = "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.end_headers()
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        url_path = self.path.split("?")[0]

        # Tudo em /api/ exige login
        cliente_logado = self.autenticar()
        if not cliente_logado:
            return

        # Confirmar entrada (Item 5.3)
        if url_path == "/api/confirmar-entrada":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode())
            entrada_id = body.get("id")
            nova_cat = body.get("categoria")
            try:
                patch_data = {"status_revisao": "confirmado", "revisado_em": datetime.datetime.now().isoformat()}
                if nova_cat: patch_data["categoria"] = nova_cat
                req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_lancamentos?id=eq.{urllib.parse.quote(str(entrada_id))}&{filtro_cliente(cliente_logado)}", data=json.dumps(patch_data).encode(), headers={**HEADERS_SUPABASE, "Prefer": "return=representation"}, method="PATCH")
                with urllib.request.urlopen(req) as resp_conf:
                    alterados = json.loads(resp_conf.read().decode() or "[]")
                if not alterados:
                    self.responder_json(404, {"erro": "Lançamento não encontrado."})
                    return
                self.responder_json(200, {"mensagem": "Entrada confirmada com sucesso!"})
            except Exception as e:
                self.responder_json(500, {"erro": str(e)})
            return

        # Tentar a leitura de novo (só envios em revisao_manual)
        if url_path == "/api/reprocessar-cupom":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode() or "{}")
            cupom_id = str(body.get("id", ""))
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", cupom_id):
                self.responder_json(400, {"erro": "Código do envio inválido."})
                return
            try:
                req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{cupom_id}&select=*", headers=HEADERS_SUPABASE)
                with urllib.request.urlopen(req) as resp:
                    linhas = json.loads(resp.read().decode())
                if not linhas:
                    self.responder_json(404, {"erro": "Envio não encontrado."})
                    return
                item = linhas[0]
                if item.get("cliente") != cliente_logado["nome"]:
                    self.responder_json(404, {"erro": "Envio não encontrado."})
                    return
                if item.get("status") != "revisao_manual":
                    self.responder_json(409, {"erro": "Só é possível tentar de novo os envios que precisam de revisão."})
                    return
                patch = {"status": "processando", "ultimo_erro": None, "atualizado_em": datetime.datetime.utcnow().isoformat() + "Z"}
                req_up = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{cupom_id}", data=json.dumps(patch).encode(), headers=HEADERS_SUPABASE, method="PATCH")
                with urllib.request.urlopen(req_up):
                    pass
                threading.Thread(target=processar_lote_com_ia, args=(cupom_id, item["storage_path"], item["cliente"]), daemon=True).start()
                self.responder_json(200, {"mensagem": "Leitura reiniciada."})
            except Exception as e:
                self.responder_json(500, {"erro": str(e)})
            return

        # Confirmar todas em lote (Item 5.3)
        if url_path == "/api/confirmar-todas":
            try:
                patch_data = {"status_revisao": "confirmado", "revisado_em": datetime.datetime.now().isoformat()}
                req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_lancamentos?status_revisao=neq.confirmado&{filtro_cliente(cliente_logado)}", data=json.dumps(patch_data).encode(), headers=HEADERS_SUPABASE, method="PATCH")
                with urllib.request.urlopen(req):
                    pass
                self.responder_json(200, {"mensagem": "Todas as entradas foram confirmadas!"})
            except Exception as e:
                self.responder_json(500, {"erro": str(e)})
            return

        # Upload de Cupom (Item 2: limite de 10 MB e validação)
        if url_path == "/api/upload-cupom":
            self.tratar_upload_cupom(cliente_logado)
            return

        self.send_response(404)
        self.end_headers()

    def tratar_upload_cupom(self, cliente_logado):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.responder_json(400, {"erro": "Formato inválido."})
            return

        try:
            boundary = content_type.split("boundary=")[1].encode("utf-8")
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            campos = {}
            arquivos = {}

            partes = body.split(b"--" + boundary)
            for parte in partes:
                if not parte or parte in [b"--\r\n", b"--"]: continue
                if b"\r\n\r\n" not in parte: continue
                header_raw, conteudo_raw = parte.split(b"\r\n\r\n", 1)
                conteudo = conteudo_raw.rstrip(b"\r\n")
                header_str = header_raw.decode("utf-8", errors="ignore")

                nome_match = re.search(r'name="([^"]+)"', header_str)
                filename_match = re.search(r'filename="([^"]+)"', header_str)

                if nome_match:
                    nome_campo = nome_match.group(1)
                    if filename_match:
                        arquivos[nome_campo] = {
                            "filename": filename_match.group(1),
                            "dados": conteudo
                        }
                    else:
                        campos[nome_campo] = conteudo.decode("utf-8", errors="ignore")

            cliente = cliente_logado["nome"]  # sempre o cliente do login
            tamanho_orig = int(campos.get("tamanho_original", 0))
            tamanho_comp = int(campos.get("tamanho_comprimido", 0))
            img_info = arquivos.get("imagem")

            if not img_info or len(img_info["dados"]) == 0:
                self.responder_json(400, {"erro": "Nenhuma imagem enviada."})
                return

            # Validação no backend: Tamanho final máximo de 10 MB (Item 2 do Backlog)
            if len(img_info["dados"]) > (10 * 1024 * 1024):
                self.responder_json(400, {"erro": "Arquivo excede o limite máximo permitido de 10 MB."})
                return

            # Upload Storage
            hoje = datetime.datetime.now()
            storage_path = f"{slug_cliente(cliente)}/{hoje.strftime('%Y-%m')}/{uuid.uuid4()}.jpg"
            storage_url = f"{SUPABASE_URL}/storage/v1/object/cupons/{storage_path}"
            req_st = urllib.request.Request(storage_url, data=img_info["dados"], headers={"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY, "Content-Type": "image/jpeg"}, method="POST")
            with urllib.request.urlopen(req_st, timeout=20):
                pass

            # Inserir na Fila
            payload_fila = {
                "cliente": cliente,
                "storage_path": storage_path,
                "mime_type": "image/jpeg",
                "tamanho_original_bytes": tamanho_orig or len(img_info["dados"]),
                "tamanho_comprimido_bytes": len(img_info["dados"]),
                "status": "pendente",
                "tentativas": 0
            }
            req_db = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila", data=json.dumps(payload_fila).encode(), headers={**HEADERS_SUPABASE, "Prefer": "return=representation"}, method="POST")
            with urllib.request.urlopen(req_db, timeout=10) as resp_db:
                registro = json.loads(resp_db.read().decode())[0]

            # Iniciar processador de IA
            threading.Thread(
                target=processar_lote_com_ia,
                args=(registro.get("id"), storage_path, cliente),
                daemon=True
            ).start()

            self.responder_json(201, {
                "id": registro.get("id"),
                "storage_path": storage_path,
                "mensagem": "Cupom recebido com sucesso!"
            })

        except Exception as e:
            self.responder_json(500, {"erro": str(e)})

if __name__ == "__main__":
    porta = 3000
    servidor = HTTPServer(("0.0.0.0", porta), DevHandler)
    print(f"\n==================================================================")
    print(f" Servidor North Stack Ativo: http://localhost:{porta}")
    print(f" Design System | Clientes Reais | Lote Max 5 | Dashboard & Entradas")
    print(f"==================================================================\n")
    sys.stdout.flush()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
