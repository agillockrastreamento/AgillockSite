"""
Gera os assets do app (ícone, adaptive-icon, splash e favicon) a partir
do logo da marca. Fundo branco, coerente com app.json.

Uso: python scripts/generate_icons.py
"""
from PIL import Image
import os

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
LOGO = os.path.join(ASSETS, "logo_agillock_new.png")      # Ágil(preto) + Lock(amarelo) + escudo
SYMBOL = os.path.join(ASSETS, "agillock_new_symbol.png")  # só o escudo (quadrado)

WHITE = (255, 255, 255, 255)


def trim(im):
    """Recorta a área não-transparente."""
    bbox = im.split()[3].getbbox()
    return im.crop(bbox) if bbox else im


def place_centered(canvas_size, content, target_w_ratio, bg=None):
    """Cria um canvas quadrado e centraliza o content escalado por largura."""
    W = canvas_size
    base = Image.new("RGBA", (W, W), bg if bg else (0, 0, 0, 0))
    target_w = int(W * target_w_ratio)
    ratio = content.height / content.width
    target_h = int(target_w * ratio)
    resized = content.resize((target_w, target_h), Image.LANCZOS)
    x = (W - target_w) // 2
    y = (W - target_h) // 2
    base.alpha_composite(resized, (x, y))
    return base


def main():
    logo = trim(Image.open(LOGO).convert("RGBA"))
    symbol = trim(Image.open(SYMBOL).convert("RGBA"))

    # 1) icon.png — 1024x1024, fundo branco (iOS exige opaco)
    icon = place_centered(1024, logo, 0.82, bg=WHITE)
    icon.convert("RGB").save(os.path.join(ASSETS, "icon.png"))
    print("icon.png OK")

    # 2) adaptive-icon.png — 1024x1024, foreground transparente dentro da
    #    safe zone (~66%); backgroundColor (#ffffff) vem do app.json
    adaptive = place_centered(1024, logo, 0.60)
    adaptive.save(os.path.join(ASSETS, "adaptive-icon.png"))
    print("adaptive-icon.png OK")

    # 3) splash-icon.png — logo centralizado, transparente (splash usa
    #    backgroundColor #ffffff + resizeMode contain)
    splash = place_centered(1024, logo, 0.74)
    splash.save(os.path.join(ASSETS, "splash-icon.png"))
    print("splash-icon.png OK")

    # 4) favicon.png — web; usa o símbolo (quadrado fica melhor em tamanho mínimo)
    favicon = place_centered(64, symbol, 0.82, bg=WHITE)
    favicon.convert("RGB").save(os.path.join(ASSETS, "favicon.png"))
    print("favicon.png OK")


if __name__ == "__main__":
    main()
