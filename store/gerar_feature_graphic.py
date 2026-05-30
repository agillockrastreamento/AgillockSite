"""
Feature Graphic do Google Play (1024x500) com a identidade da marca.
Saida: store/out/feature_graphic_1024x500.png
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
from gerar_lojas import load_screen, phone_frame, f, SCREENS  # noqa: E402

ASSETS = os.path.join(HERE, "..", "app", "assets")
OUT = os.path.join(HERE, "out", "feature_graphic_1024x500.png")
AMBER = (245, 166, 35)
W, H = 1024, 500


def trim(im):
    bb = im.split()[3].getbbox()
    return im.crop(bb) if bb else im


def main():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    for y in range(H):
        t = y / H
        ImageDraw.Draw(img).line([(0, y), (W, y)], fill=(int(8 + t * 16), int(12 + t * 22), int(18 + t * 36), 255))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-200, -160, 460, 420], fill=AMBER + (60,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(150)))
    d = ImageDraw.Draw(img)

    # logo branco
    logo = trim(Image.open(os.path.join(ASSETS, "logo_agillock_white_new.png")).convert("RGBA"))
    lw = 360
    lh = int(lw * logo.height / logo.width)
    img.alpha_composite(logo.resize((lw, lh), Image.LANCZOS), (70, 96))

    # tagline
    d.text((74, 96 + lh + 26), "Rastreamento e gestão", font=f("Bold", 40), fill=(255, 255, 255))
    d.text((74, 96 + lh + 74), "da sua frota", font=f("Bold", 40), fill=AMBER)
    d.text((76, 96 + lh + 134), "Tempo real • Alertas • Relatórios • Manutenção",
           font=f("Medium", 22), fill=(200, 205, 212))

    # celular (tela do mapa) espiando da direita
    screen_w = 250
    screen_h = int(screen_w * 19.5 / 9)
    screen = load_screen(SCREENS[0][0], screen_w, screen_h)
    frame = phone_frame(screen, screen_w)
    fx, fy = 720, 70
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([fx, fy + 16, fx + frame.width, fy + frame.height + 16],
                                         radius=40, fill=(0, 0, 0, 150))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(35)))
    img.alpha_composite(frame, (fx, fy))

    img.convert("RGB").save(OUT, quality=92)
    print("salvo:", OUT, (W, H))


if __name__ == "__main__":
    main()
