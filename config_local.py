# -*- coding: utf-8 -*-
"""Lê SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e GEMINI_API_KEY do ambiente ou do arquivo .env.
Os scripts locais (dev_server.py etc.) usam isto em vez de chaves no código."""
import os

_dir = os.path.dirname(os.path.abspath(__file__))
_env = os.path.join(_dir, ".env")
if os.path.exists(_env):
    with open(_env, encoding="utf-8", errors="ignore") as f:
        for linha in f:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def _exigir(nome):
    valor = os.environ.get(nome, "")
    if not valor:
        raise SystemExit(f"Falta {nome}. Copie .env.example para .env e preencha.")
    return valor

SUPABASE_URL = _exigir("SUPABASE_URL")
SUPABASE_KEY = _exigir("SUPABASE_SERVICE_ROLE_KEY")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
