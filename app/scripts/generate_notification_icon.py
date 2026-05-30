"""
Gera o ícone de notificação do Android (notification-icon.png).
Android usa apenas o canal alpha: a silhueta é desenhada em branco e
tingida pela cor 'color' do expo-notifications. Usamos o emblema do
escudo como silhueta branca sobre fundo transparente -- os vãos internos
(buraco da fechadura, arcos do wifi, campo entre borda e cadeado) ficam
transparentes e preservam o desenho.

Uso: python scripts/generate_notification_icon.py
"""
from PIL import Image
import os

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
SYMBOL = os.path.join(ASSETS, "agillock_new_symbol.png")
OUT = os.path.join(ASSETS, "notification-icon.png")


def trim(im):
    bbox = im.split()[3].getbbox()
    return im.crop(bbox) if bbox else im


def main():
    symbol = trim(Image.open(SYMBOL).convert("RGBA"))

    # silhueta branca a partir do alpha do emblema
    white = Image.new("RGBA", symbol.size, (255, 255, 255, 0))
    white.putalpha(symbol.split()[3])

    # canvas quadrado transparente, escala pelo maior lado (~84%)
    SIZE = 1024
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    box = int(SIZE * 0.84)
    scale = min(box / white.width, box / white.height)
    tw, th = int(white.width * scale), int(white.height * scale)
    white = white.resize((tw, th), Image.LANCZOS)
    canvas.alpha_composite(white, ((SIZE - tw) // 2, (SIZE - th) // 2))
    canvas.save(OUT)
    print("salvo:", OUT, canvas.size)


if __name__ == "__main__":
    main()
