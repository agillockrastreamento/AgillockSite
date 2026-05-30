"""
Gera os assets do app:
- icon.png / adaptive-icon.png: emblema do escudo recolorido em amarelo
  (borda inclusive) sobre fundo preto.
- splash-icon.png: logo ÁgilLock completo (transparente, splash usa fundo branco).
- favicon.png: símbolo (web).

Uso: python scripts/generate_icons.py
"""
from PIL import Image
import os

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
LOGO = os.path.join(ASSETS, "logo_agillock_new.png")            # Ágil(preto) + Lock(amarelo) — fundo claro
LOGO_WHITE = os.path.join(ASSETS, "logo_agillock_white_new.png")  # Ágil(branco) + Lock(amarelo) — fundo escuro
SYMBOL = os.path.join(ASSETS, "agillock_new_symbol.png")        # só o escudo (quadrado)

WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
# amarelo da marca #F5A623 em HSV (0-255): H=27, S=219
AMBER_H, AMBER_S = 27, 219


def trim(im):
    bbox = im.split()[3].getbbox()
    return im.crop(bbox) if bbox else im


def recolor_amber(im):
    """Mantém o brilho (V) e troca tom/saturação para o amarelo -> a borda
    prata do escudo vira amarela com o mesmo relevo."""
    alpha = im.split()[3]
    h, s, v = im.convert("RGB").convert("HSV").split()
    rgb = Image.merge("HSV", (Image.new("L", im.size, AMBER_H),
                              Image.new("L", im.size, AMBER_S), v)).convert("RGB")
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def place_by_width(canvas_px, content, w_ratio, bg=(0, 0, 0, 0)):
    """Centraliza o content escalado pela largura."""
    base = Image.new("RGBA", (canvas_px, canvas_px), bg)
    tw = int(canvas_px * w_ratio)
    th = int(tw * content.height / content.width)
    base.alpha_composite(content.resize((tw, th), Image.LANCZOS),
                         ((canvas_px - tw) // 2, (canvas_px - th) // 2))
    return base


def place_by_max(canvas_px, content, ratio, bg=(0, 0, 0, 0)):
    """Centraliza o content cabendo numa caixa (escala pelo maior lado)."""
    base = Image.new("RGBA", (canvas_px, canvas_px), bg)
    box = int(canvas_px * ratio)
    scale = min(box / content.width, box / content.height)
    tw, th = int(content.width * scale), int(content.height * scale)
    base.alpha_composite(content.resize((tw, th), Image.LANCZOS),
                         ((canvas_px - tw) // 2, (canvas_px - th) // 2))
    return base


def main():
    logo_white = trim(Image.open(LOGO_WHITE).convert("RGBA"))
    symbol = trim(Image.open(SYMBOL).convert("RGBA"))
    emblem = recolor_amber(symbol)

    # 1) icon.png — fundo preto + emblema amarelo (iOS exige opaco)
    place_by_max(1024, emblem, 0.78, bg=BLACK).convert("RGB").save(
        os.path.join(ASSETS, "icon.png"))
    print("icon.png OK")

    # 2) adaptive-icon.png — emblema amarelo transparente dentro da safe zone;
    #    backgroundColor (#000000) vem do app.json
    place_by_max(1024, emblem, 0.62).save(os.path.join(ASSETS, "adaptive-icon.png"))
    print("adaptive-icon.png OK")

    # 3) splash-icon.png — logo branco (splash usa fundo PRETO + resizeMode contain)
    place_by_width(1024, logo_white, 0.74).save(os.path.join(ASSETS, "splash-icon.png"))
    print("splash-icon.png OK")

    # 4) favicon.png — web; emblema amarelo em fundo preto (combina com o ícone)
    place_by_max(64, emblem, 0.82, bg=BLACK).convert("RGB").save(
        os.path.join(ASSETS, "favicon.png"))
    print("favicon.png OK")


if __name__ == "__main__":
    main()
