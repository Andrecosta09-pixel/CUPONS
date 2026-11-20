# -*- coding: utf-8 -*-
import urllib.request
import json

from config_local import SUPABASE_URL, SUPABASE_KEY

headers_supabase = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

# Dados extraídos pela IA dos 4 cupons da foto
cupons_extraidos = [
  {
    "data_emissao": "2026-11-11",
    "estabelecimento": "FRUTARIA WL",
    "cnpj": "05518176000153",
    "valor_total": 96.38,
    "forma_pagamento": "dinheiro",
    "categoria": "hortifruti",
    "resumo_itens": "BANANA COMP NO EXP KG"
  },
  {
    "data_emissao": "2026-11-11",
    "estabelecimento": "Araujo & Saraiva Ltda",
    "cnpj": "07573569000438",
    "valor_total": 24.87,
    "forma_pagamento": "cartao",
    "categoria": "supermercado",
    "resumo_itens": "CUSCUZ MILHO CIGANO, PAD CASEIRO NI KG"
  },
  {
    "data_emissao": "2026-11-11",
    "estabelecimento": "Araujo & Saraiva Ltda",
    "cnpj": "07573569000357",
    "valor_total": 33.63,
    "forma_pagamento": "cartao",
    "categoria": "supermercado",
    "resumo_itens": "SAL DO PTIGUAR 1KG, AVEIA, TOMATE KG, CEBOLA KG, PIMENTAO CHEIRO KG, LIMAO FRUTO KG"
  },
  {
    "data_emissao": "2026-11-06",
    "estabelecimento": "HASTA LTDA ME",
    "cnpj": "09691780000145",
    "valor_total": 74.0,
    "forma_pagamento": "cartao",
    "categoria": "supermercado",
    "resumo_itens": "AZEITONA VERDE FATIADA 1,8KG"
  }
]

# Pegar o ID do cupom na fila
req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?order=criado_em.desc&limit=1", headers=headers_supabase)
with urllib.request.urlopen(req) as resp:
    cupom_fila = json.loads(resp.read().decode())[0]

cupom_id = cupom_fila["id"]
cliente = cupom_fila["cliente"]

# Salvar todos os 4 cupons em cupons_lancamentos
for c in cupons_extraidos:
    payload = {
        "cupom_id": cupom_id,
        "cliente": cliente,
        "data_emissao": c.get("data_emissao"),
        "estabelecimento": c.get("estabelecimento"),
        "cnpj": c.get("cnpj"),
        "valor_total": c.get("valor_total"),
        "forma_pagamento": c.get("forma_pagamento"),
        "categoria": c.get("categoria"),
        "resumo_itens": c.get("resumo_itens"),
        "dados_brutos_json": c
    }
    req_ins = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_lancamentos", data=json.dumps(payload).encode(), headers=headers_supabase, method="POST")
    with urllib.request.urlopen(req_ins):
        print(f"Salvo: {c['estabelecimento']} - R$ {c['valor_total']}")

# Atualizar fila para processado
req_up = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/cupons_fila?id=eq.{cupom_id}", data=json.dumps({"status": "processado"}).encode(), headers=headers_supabase, method="PATCH")
with urllib.request.urlopen(req_up):
    pass

print("TODOS OS 4 CUPONS SALVOS COM SUCESSO NO BANCO!")
