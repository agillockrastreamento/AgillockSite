#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera o PDF da documentacao a partir do Markdown, no tema (amarelo) do projeto.
Fluxo: Markdown -> HTML estilizado -> PDF (Chrome headless).

Uso:
    pip install markdown
    python gerar-pdf.py            # usa API-Integracao-Externa.md
    python gerar-pdf.py outro.md   # outro arquivo

Requer Google Chrome instalado (procura nos caminhos padrao do Windows).
"""
import os
import subprocess
import sys

import markdown

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEM = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, 'API-Integracao-Externa.md')
BASE = os.path.splitext(ORIGEM)[0]
HTML_TMP = BASE + '.__tmp.html'
PDF_OUT = BASE + '.pdf'

# Cores do tema AgilLock (--al-primary e variantes)
AMARELO = '#fab32c'
AMARELO_ESCURO = '#c8870a'
AMARELO_TEXTO = '#8a5e06'   # tom escuro para texto sobre fundo branco (contraste)
TINTA_TH = '#3a2c05'        # texto escuro sobre o fundo amarelo das tabelas

CSS = f"""
@page {{ size: A4; margin: 18mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'Segoe UI', Arial, sans-serif; font-size: 11.5px; line-height: 1.55;
  color: #1f2430; max-width: 100%; }}
h1 {{ font-size: 23px; color: {AMARELO_TEXTO}; border-bottom: 3px solid {AMARELO};
  padding-bottom: 6px; margin: 0 0 14px; }}
h2 {{ font-size: 16px; color: {AMARELO_ESCURO}; margin: 22px 0 8px; padding-top: 6px;
  border-top: 1px solid #efe6d2; }}
h3 {{ font-size: 13.5px; color: #11243f; margin: 14px 0 6px; }}
h2, h3 {{ page-break-after: avoid; }}
p, li {{ margin: 5px 0; }}
a {{ color: {AMARELO_ESCURO}; text-decoration: none; }}
code {{ font-family: 'Consolas','Courier New',monospace; font-size: 10.5px;
  background: #fdf4e3; padding: 1px 5px; border-radius: 4px; color: #a83215; }}
pre {{ background: #1c1206; color: #f3e6cf; padding: 12px 14px; border-radius: 8px;
  overflow-x: auto; font-size: 10px; line-height: 1.5; page-break-inside: avoid;
  border-left: 3px solid {AMARELO}; }}
pre code {{ background: none; color: inherit; padding: 0; font-size: 10px; }}
table {{ border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px;
  page-break-inside: avoid; }}
th, td {{ border: 1px solid #e6dcc6; padding: 6px 9px; text-align: left; vertical-align: top; }}
th {{ background: {AMARELO}; color: {TINTA_TH}; font-weight: 700; }}
tr:nth-child(even) td {{ background: #fffaf0; }}
blockquote {{ margin: 10px 0; padding: 8px 14px; background: #fff8e6;
  border-left: 4px solid {AMARELO}; border-radius: 0 6px 6px 0; }}
blockquote p {{ margin: 3px 0; }}
hr {{ border: none; border-top: 1px solid #efe6d2; margin: 18px 0; }}
strong {{ color: #11243f; }}
"""


def achar_chrome():
    candidatos = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidatos:
        if os.path.exists(c):
            return c
    print("ERRO: Chrome/Edge não encontrado.", file=sys.stderr)
    sys.exit(1)


def main():
    md = open(ORIGEM, encoding='utf-8').read()
    body = markdown.markdown(md, extensions=['tables', 'fenced_code', 'sane_lists', 'toc'])
    html = (f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
            f'<title>Documentação AgilLock</title><style>{CSS}</style></head>'
            f'<body>{body}</body></html>')
    open(HTML_TMP, 'w', encoding='utf-8').write(html)

    chrome = achar_chrome()
    subprocess.run([
        chrome, '--headless', '--disable-gpu', '--no-pdf-header-footer',
        f'--print-to-pdf={PDF_OUT}', 'file:///' + HTML_TMP.replace('\\', '/'),
    ], check=True, capture_output=True)

    os.remove(HTML_TMP)
    print(f"OK: {PDF_OUT} ({round(os.path.getsize(PDF_OUT)/1024)} KB)")


if __name__ == '__main__':
    main()
