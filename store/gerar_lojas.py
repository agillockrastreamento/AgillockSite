"""
Gera artes de loja (App Store / Google Play) a partir dos prints reais.
- Modo panorama: fundo contínuo que flui entre as telas (galeria deslizante).
- Moldura de celular + headline/subtítulo (fonte Montserrat).

Uso:
  python store/gerar_lojas.py apple    # 1320x2868 (6.9")
  python store/gerar_lojas.py google   # 1080x2400
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "printsevideos")
FONTS = os.path.join(HERE, "fonts")
OUTDIR = os.path.join(HERE, "out")
ASSETS = os.path.join(HERE, "..", "app", "assets")

AMBER = (245, 166, 35)
WHITE = (255, 255, 255)
SUB = (200, 205, 212)

PRESETS = {
    "apple": (1320, 2868),
    "google": (1080, 2400),
}

# (arquivo, linha1, linha2, subtitulo)
SCREENS = [
    ("Screenshot_2026-05-30-09-06-21-698_br.com.agillock.cliente.jpg",
     "Acompanhe sua frota", "em tempo real", "Localização ao vivo no mapa, a qualquer hora"),
    ("Screenshot_2026-05-30-09-31-53-574_br.com.agillock.cliente.jpg",
     "Alertas e notificações", "instantâneas", "Saiba na hora de cada evento importante"),
    ("historicoatualizado.jpg",
     "Histórico de trajetos", "e rotas", "Reveja por onde seus veículos passaram"),
    ("Screenshot_2026-05-30-09-19-27-183_br.com.agillock.cliente.jpg",
     "Relatórios completos", "na palma da mão", "Exporte e analise os dados da frota"),
    ("Screenshot_2026-05-30-09-23-32-481_br.com.agillock.cliente.jpg",
     "Planos de manutenção", "em minutos", "Organize revisões e nunca perca um prazo"),
    ("Screenshot_2026-05-30-09-22-12-758_br.com.agillock.cliente.jpg",
     "Cada veículo", "em detalhes", "Informações, fotos e comandos num só lugar"),
]

STATUS_BAR_CROP = 72  # remove a barra de status do Android (px no topo, em 1080w)


def f(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f"Montserrat-{weight}.ttf"), size)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def cover_fit(im, tw, th):
    """Escala cobrindo (tw,th) e corta o excesso (center-crop)."""
    scale = max(tw / im.width, th / im.height)
    nw, nh = int(im.width * scale), int(im.height * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return im.crop((x, y, x + tw, y + th))


def load_screen(fname, sw, sh):
    im = Image.open(os.path.join(RAW, fname)).convert("RGB")
    # remove barra de status do Android (proporcional à largura real)
    crop_px = int(STATUS_BAR_CROP * im.width / 1080)
    im = im.crop((0, crop_px, im.width, im.height))
    return cover_fit(im, sw, sh)


def phone_frame(screen_img, scale_w):
    """Monta a moldura do celular ao redor do screen_img (já no tamanho da tela)."""
    sw, sh = screen_img.size
    bezel = max(14, int(sw * 0.022))
    radius = int(sw * 0.12)
    fw, fh = sw + bezel * 2, sh + bezel * 2
    frame = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    d = ImageDraw.Draw(frame)
    d.rounded_rectangle([0, 0, fw - 1, fh - 1], radius=radius + bezel,
                        fill=(10, 10, 12, 255), outline=(64, 64, 70, 255), width=3)
    screen = screen_img.convert("RGBA")
    screen.putalpha(rounded_mask((sw, sh), radius))
    frame.alpha_composite(screen, (bezel, bezel))
    # notch
    d.rounded_rectangle([fw // 2 - int(sw * 0.13), bezel + 6,
                         fw // 2 + int(sw * 0.13), bezel + int(sw * 0.05)],
                        radius=18, fill=(10, 10, 12, 255))
    return frame


def draw_headline(draw, cx, top, l1, l2, sub, panel_w):
    usable = panel_w - 160
    # ajusta o tamanho da fonte se a linha for muito larga
    size = int(panel_w * 0.066)
    fb = f("Bold", size)
    while max(draw.textlength(l1, font=fb), draw.textlength(l2, font=fb)) > usable and size > 40:
        size -= 2
        fb = f("Bold", size)
    fsub = f("Medium", int(panel_w * 0.033))

    def center(txt, y, fnt, fill):
        w = draw.textlength(txt, font=fnt)
        draw.text((cx - w / 2, y), txt, font=fnt, fill=fill)

    lh = size * 1.12
    center(l1, top, fb, WHITE)
    center(l2, top + lh, fb, AMBER)
    center(sub, top + lh * 2 + 18, fsub, SUB)


def build_panorama(preset):
    W, H = PRESETS[preset]
    n = len(SCREENS)
    canvas = Image.new("RGBA", (W * n, H), (0, 0, 0, 255))

    # fundo: gradiente vertical escuro (igual em toda a largura)
    grad = Image.new("RGBA", (1, H))
    for y in range(H):
        t = y / H
        grad.putpixel((0, y), (int(8 + t * 18), int(12 + t * 26), int(18 + t * 42), 255))
    canvas.alpha_composite(grad.resize((W * n, H)))

    # brilhos âmbar fluindo ao longo do panorama
    glow = Image.new("RGBA", (W * n, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(n):
        gx = int((i + 0.5) * W)
        gy = int(H * 0.12)
        gd.ellipse([gx - 560, gy - 480, gx + 560, gy + 480], fill=AMBER + (46,))
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    canvas.alpha_composite(glow)

    d = ImageDraw.Draw(canvas)

    for i, (fname, l1, l2, sub) in enumerate(SCREENS):
        ox = i * W
        draw_headline(d, ox + W // 2, int(H * 0.052), l1, l2, sub, W)

        # tela + moldura
        screen_w = int(W * 0.72)
        screen_h = int(screen_w * 19.5 / 9)
        screen = load_screen(fname, screen_w, screen_h)
        frame = phone_frame(screen, screen_w)
        fx = ox + (W - frame.width) // 2
        fy = int(H * 0.215)
        # sombra
        sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle(
            [fx, fy + 20, fx + frame.width, fy + frame.height + 20],
            radius=int(screen_w * 0.14), fill=(0, 0, 0, 150))
        canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(45)))
        canvas.alpha_composite(frame, (fx, fy))

    return canvas


def main():
    preset = sys.argv[1] if len(sys.argv) > 1 else "apple"
    W, H = PRESETS[preset]
    os.makedirs(OUTDIR, exist_ok=True)
    pano = build_panorama(preset)

    # salva o panorama inteiro (para conferência)
    prev = pano.resize((pano.width // 6, pano.height // 6), Image.LANCZOS)
    prev.convert("RGB").save(os.path.join(OUTDIR, f"_panorama_{preset}_preview.png"))

    # fatia em N imagens no tamanho exato da loja
    for i in range(len(SCREENS)):
        tile = pano.crop((i * W, 0, (i + 1) * W, H)).convert("RGB")
        tile.save(os.path.join(OUTDIR, f"{preset}_{i + 1:02d}.png"))
    print(f"{preset}: {len(SCREENS)} telas geradas em {OUTDIR} ({W}x{H})")


if __name__ == "__main__":
    main()
