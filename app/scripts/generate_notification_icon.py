"""
Gera o icone de notificacao do Android (notification-icon.png).
Android usa apenas o canal alpha: a silhueta e desenhada em branco e
tingida pela cor 'color' do expo-notifications. Por isso geramos so o
nome 'AgilLock' (sem subtitulo e sem escudo) como silhueta branca
sobre fundo transparente.

Uso: python scripts/generate_notification_icon.py
"""
from PIL import Image
import os

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
LOGO = os.path.join(ASSETS, "logo_agillock_new.png")
OUT = os.path.join(ASSETS, "notification-icon.png")


def main():
    logo = Image.open(LOGO).convert("RGBA")
    alpha = logo.split()[3]
    W, H = logo.size

    # max alpha por coluna (sem numpy)
    col_max = [0] * W
    px = alpha.load()
    for x in range(W):
        m = 0
        for y in range(0, H, 2):  # passo 2: rapido e suficiente
            v = px[x, y]
            if v > m:
                m = v
                if m == 255:
                    break
        col_max[x] = m

    # acha o maior vao transparente no terco direito (separa "Lock" do escudo)
    search_start = int(W * 0.65)
    best_len, best_start = 0, None
    run_len, run_start = 0, None
    for x in range(search_start, W):
        if col_max[x] < 10:
            if run_start is None:
                run_start = x
            run_len += 1
            if run_len > best_len:
                best_len, best_start = run_len, run_start
        else:
            run_len, run_start = 0, None
    gap_x = best_start if best_start else W
    print(f"corte do escudo em x={gap_x} (W={W})")

    # recorta a regiao do texto (sem o escudo)
    word = logo.crop((0, 0, gap_x, H))
    wpx = word.load()
    ww, wh = word.size

    # mascara binaria de conteudo
    THR = 30
    solid = [[wpx[x, y][3] > THR for x in range(ww)] for y in range(wh)]

    # flood-fill 8-conexo a partir do corpo da palavra (y < SEED_Y).
    # O "g" e seu rabo estao conectados ao corpo -> mantidos.
    # As letras do subtitulo "GESTAO DE RISCO" estao soltas -> removidas.
    from collections import deque
    SEED_Y = 335
    keep = [[False] * ww for _ in range(wh)]
    dq = deque()
    for y in range(min(SEED_Y, wh)):
        row = solid[y]
        for x in range(ww):
            if row[x]:
                keep[y][x] = True
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < ww and 0 <= ny < wh and solid[ny][nx] and not keep[ny][nx]:
                    keep[ny][nx] = True
                    dq.append((nx, ny))

    # zera tudo que nao foi alcancado (= subtitulo)
    removed = 0
    for y in range(wh):
        kr = keep[y]
        for x in range(ww):
            if solid[y][x] and not kr[x]:
                r, g, b, a = wpx[x, y]
                wpx[x, y] = (r, g, b, 0)
                removed += 1
    print(f"pixels do subtitulo removidos: {removed}")

    bbox = word.split()[3].getbbox()
    word = word.crop(bbox)
    print(f"palavra recortada: {word.size}")

    # silhueta branca a partir do alpha
    white = Image.new("RGBA", word.size, (255, 255, 255, 0))
    white.putalpha(word.split()[3])

    # canvas quadrado transparente com padding (conteudo ~84% da largura)
    SIZE = 1024
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    tw = int(SIZE * 0.84)
    th = int(tw * white.height / white.width)
    white = white.resize((tw, th), Image.LANCZOS)
    canvas.alpha_composite(white, ((SIZE - tw) // 2, (SIZE - th) // 2))
    canvas.save(OUT)
    print("salvo:", OUT, canvas.size)


if __name__ == "__main__":
    main()
