# -*- coding: utf-8 -*-
import urllib.request
import json
import base64
import time

from config_local import SUPABASE_URL, SUPABASE_KEY, GEMINI_KEY

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

# Pegar o cupom mais recente
req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?order=criado_em.desc&limit=1", headers=headers)
with urllib.request.urlopen(req) as resp:
    itens = json.loads(resp.read().decode())

if not itens:
    print("Fila vazia.")
    exit(0)

item = itens[0]
path = item["storage_path"]
print(f"Lendo {path} ({item['cliente']})...")

# Baixar imagem
req_img = urllib.request.Request(f"{SUPABASE_URL}/storage/v1/object/cupons/{path}", headers=headers)
with urllib.request.urlopen(req_img) as r_img:
    img_b64 = base64.b64encode(r_img.read()).decode("utf-8")

prompt = """Analise este cupom fiscal brasileiro e extraia os dados estritamente em JSON:
[
  {
    "valor_total": 0.00,
    "data_emissao": "YYYY-MM-DD",
    "estabelecimento": "Nome do Estabelecimento",
    "cnpj": "14 digitos numéricos",
    "resumo_itens": "resumo dos principais itens",
    "forma_pagamento": "dinheiro, cartao, pix, etc.",
    "categoria": "Mercado, Obra / construção, Combustível, Alimentação, Farmácia / saúde, Casa / utilidades, Serviços, ou Outros",
    "confianca": "alta"
  }
]
Retorne APENAS o JSON puro."""

url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key={GEMINI_KEY}"
payload = {
    "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}}]}],
    "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
}

for tent in range(3):
    try:
        print(f"Tentativa {tent+1} com Gemini 3.7 Flash...")
        req_g = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req_g, timeout=50) as r_g:
            res = json.loads(r_g.read().decode())
            texto = res["candidates"][0]["content"]["parts"][0]["text"]
            dados = json.loads(texto)
            if isinstance(dados, dict): dados = [dados]
            print("✅ DADOS EXTRAÍDOS COM SUCESSO:")
            print(json.dumps(dados, indent=2, ensure_ascii=False))

            # Inserir cada cupom
            for d in dados:
                payload_lanc = {
                    "cupom_id": item["id"],
                    "cliente": item["cliente"],
                    "data_emissao": d.get("data_emissao"),
                    "estabelecimento": d.get("estabelecimento") or "Não identificado",
                    "cnpj": str(d.get("cnpj", "")).replace(".", "").replace("/", "").replace("-", "")[:14],
                    "valor_total": float(d.get("valor_total") or 0.0),
                    "forma_pagamento": d.get("forma_pagamento") or "Outros",
                    "categoria": d.get("categoria") or "Outros",
                    "resumo_itens": d.get("resumo_itens") or "",
                    "confianca": d.get("confianca") or "alta",
                    "status_revisao": "novo",
                    "dados_brutos_json": d
                }
                req_l = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_lancamentos", data=json.dumps(payload_lanc).encode(), headers=headers, method="POST")
                with urllib.request.urlopen(req_l):
                    pass

            # Atualizar fila para processado
            req_up = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{item['id']}", data=json.dumps({"status": "processado", "ultimo_erro": None}).encode(), headers=headers, method="PATCH")
            with urllib.request.urlopen(req_up):
                pass
            print("✅ PROCESSAMENTO CONCLUÍDO COM SUCESSO!")
            break
    except Exception as e:
        print(f"Erro tentativa {tent+1}: {e}")
        time.sleep(3)
