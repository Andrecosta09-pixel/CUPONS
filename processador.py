# -*- coding: utf-8 -*-
import urllib.request
import json
import base64
import time

from config_local import SUPABASE_URL, SUPABASE_KEY, GEMINI_KEY

headers_supabase = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}"
}

# 1. Pegar item pendente
req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?status=eq.pendente&limit=1", headers=headers_supabase)
with urllib.request.urlopen(req) as resp:
    itens = json.loads(resp.read().decode())

if not itens:
    print("Nenhum item pendente!")
    exit(0)

item = itens[0]
path = item["storage_path"]
print(f"Baixando imagem {path}...")

# 2. Baixar imagem do Storage
req_img = urllib.request.Request(f"{SUPABASE_URL}/storage/v1/object/cupons/{path}", headers=headers_supabase)
with urllib.request.urlopen(req_img) as r_img:
    img_b64 = base64.b64encode(r_img.read()).decode("utf-8")

# 3. Chamar Gemini com fallback e retry
prompt = """Você é um especialista em ler cupons fiscais brasileiros.
Analise a imagem e extraia os dados em formato JSON estrito:
{
  "data_emissao": "YYYY-MM-DD",
  "estabelecimento": "Nome do Estabelecimento",
  "cnpj": "somente numeros",
  "valor_total": 0.00,
  "forma_pagamento": "dinheiro, cartao, pix, etc.",
  "categoria": "supermercado, ingredientes, etc.",
  "resumo_itens": "resumo dos itens"
}
Responda APENAS o JSON puro sem markdown."""

modelos = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-lite-latest", "gemini-3.5-flash"]
dados = None

for modelo in modelos:
    print(f"Tentando modelo {modelo}...")
    url_gemini = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={GEMINI_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}}]}],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }
    
    sucesso = False
    for tentativa in range(3):
        try:
            req_gem = urllib.request.Request(url_gemini, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req_gem, timeout=25) as r_gem:
                res_gem = json.loads(r_gem.read().decode())
                texto = res_gem["candidates"][0]["content"]["parts"][0]["text"]
                dados = json.loads(texto)
                print(f"✅ SUCESSO COM O MODELO {modelo}!")
                print(json.dumps(dados, indent=2, ensure_ascii=False))
                sucesso = True
                break
        except urllib.error.HTTPError as e:
            print(f"  {modelo} tentativa {tentativa+1} retornou {e.code}. Aguardando 3s...")
            time.sleep(3)
        except Exception as e:
            print(f"  {modelo} erro: {e}")
            break
            
    if sucesso:
        break

if not dados:
    print("❌ Falha em todos os modelos. Tentará novamente no próximo ciclo.")
    exit(1)

# 4. Inserir em cupons_lancamentos
payload_lanc = {
    "cupom_id": item["id"],
    "cliente": item["cliente"],
    "data_emissao": dados.get("data_emissao"),
    "estabelecimento": dados.get("estabelecimento"),
    "cnpj": str(dados.get("cnpj", "")).replace(".", "").replace("/", "").replace("-", ""),
    "valor_total": dados.get("valor_total"),
    "forma_pagamento": dados.get("forma_pagamento"),
    "categoria": dados.get("categoria"),
    "resumo_itens": dados.get("resumo_itens"),
    "dados_brutos_json": dados
}
req_l = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_lancamentos", data=json.dumps(payload_lanc).encode(), headers={**headers_supabase, "Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req_l):
    pass

# 5. Atualizar fila
req_up = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{item['id']}", data=json.dumps({"status": "processado"}).encode(), headers={**headers_supabase, "Content-Type": "application/json"}, method="PATCH")
with urllib.request.urlopen(req_up):
    pass

print("✅ CUPOM GRAVADO EM LANCAMENTOS E MARCADO COMO PROCESSADO!")
