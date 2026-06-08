#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Busca os MOTORISTAS (e o vinculo motorista->dispositivo recuperavel) direto da
API ao vivo do sistema anterior (Azul Monitor / Traccar em monitorando.me).

Diferente das planilhas, motoristas nao tem export — vem so da API. Este script
chama /drivers, /devices e /positions e gera os JSON consumidos por
import-motoristas.ts.

Credenciais via variaveis de ambiente (NAO commitar):
    MONITORANDO_USER=email   MONITORANDO_PASS=senha
    MONITORANDO_API=https://server.monitorando.me/api   (opcional, ja e o default)

Uso:
    MONITORANDO_USER=... MONITORANDO_PASS=... python fetch-monitorando.py

Gera em ./data:
    motoristas.json          [{ nome, identificador }]
    motoristas-vinculos.json [{ imei, driverUniqueId }]   (so os recuperaveis)
"""
import base64
import json
import os
import sys
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(AQUI, "data")
BASE = os.environ.get("MONITORANDO_API", "https://server.monitorando.me/api")
USER = os.environ.get("MONITORANDO_USER")
PASS = os.environ.get("MONITORANDO_PASS")


def get(caminho):
    url = f"{BASE}{caminho}"
    cred = base64.b64encode(f"{USER}:{PASS}".encode()).decode()
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "Authorization": "Basic " + cred,
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    if not USER or not PASS:
        print("ERRO: defina MONITORANDO_USER e MONITORANDO_PASS no ambiente.", file=sys.stderr)
        sys.exit(1)
    os.makedirs(DESTINO, exist_ok=True)

    drivers = get("/drivers?all=true")
    devices = get("/devices?all=true")
    positions = get("/positions")

    motoristas = [
        {"nome": (d.get("name") or "").strip(), "identificador": (d.get("uniqueId") or "").strip()}
        for d in drivers
        if (d.get("uniqueId") or "").strip()
    ]

    # vinculo recuperavel: ultima posicao traz attributes.driverUniqueId
    id2imei = {x["id"]: x.get("uniqueId") for x in devices}
    vinculos = []
    for p in positions:
        du = (p.get("attributes") or {}).get("driverUniqueId")
        imei = id2imei.get(p.get("deviceId"))
        if du and imei:
            vinculos.append({"imei": str(imei), "driverUniqueId": str(du)})

    with open(os.path.join(DESTINO, "motoristas.json"), "w", encoding="utf-8") as fp:
        json.dump(motoristas, fp, ensure_ascii=False, indent=2)
    with open(os.path.join(DESTINO, "motoristas-vinculos.json"), "w", encoding="utf-8") as fp:
        json.dump(vinculos, fp, ensure_ascii=False, indent=2)

    print(f"OK: {len(motoristas)} motoristas -> data/motoristas.json")
    print(f"OK: {len(vinculos)} vinculos motorista-dispositivo -> data/motoristas-vinculos.json")


if __name__ == "__main__":
    main()
