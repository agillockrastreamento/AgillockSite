"""
Video promocional v2 (Google Play / YouTube):
- Card de TITULO centralizado antes de cada cena (footage fica limpa, sem texto por cima).
- Transicoes variadas (fade nos titulos, slide entre funcionalidades).
- Trilha sonora (Pixabay, royalty-free) com fade in/out.

Saida: store/out/google_promo_v2_1080x2400.mp4
"""
import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "printsevideos")
FONTS = os.path.join(HERE, "fonts")
ASSETS = os.path.join(HERE, "..", "assets")
OUTDIR = os.path.join(HERE, "out")
SRC = os.path.join(RAW, "Screenrecorder-2026-05-30-09-24-56-725.mp4")
MUSIC = os.path.join(OUTDIR, "music", "pix_audio_e0908e8569.mp3")
OUT = os.path.join(OUTDIR, "google_promo_v2_1080x2400.mp4")
FFMPEG = r"C:\Users\Pedro\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"

W, H, FPS = 1080, 2400, 30
AMBER = (245, 166, 35)

# (titulo, subtitulo, inicio_no_video, duracao_footage)
# Tempos conferidos frame a frame para cada tela aparecer de verdade.
FEATURES = [
    ("Acompanhe em tempo real", "Sua frota ao vivo no mapa", 64.0, 5.0),
    ("Histórico e trajetos", "Reveja as viagens dos veículos", 16.0, 5.0),
    ("Relatórios completos", "Dados detalhados da frota", 44.0, 5.0),
    ("Planos de manutenção", "Nunca perca uma revisão", 54.5, 5.0),
    ("Cada veículo em detalhes", "Informações, fotos e comandos", 5.0, 5.0),
]
INTRO_DUR, OUTRO_DUR, TITLE_DUR = 2.2, 3.0, 2.3


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f"Montserrat-{weight}.ttf"), size)


def trim(im):
    bb = im.split()[3].getbbox()
    return im.crop(bb) if bb else im


def recolor_amber(im):
    a = im.split()[3]
    h, s, v = im.convert("RGB").convert("HSV").split()
    rgb = Image.merge("HSV", (Image.new("L", im.size, 27), Image.new("L", im.size, 219), v)).convert("RGB")
    o = rgb.convert("RGBA"); o.putalpha(a)
    return o


def run(args):
    subprocess.run(args, check=True)


def bg_base(d, img):
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(8 + t * 16), int(12 + t * 22), int(18 + t * 38), 255))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W // 2 - 620, H // 2 - 820, W // 2 + 620, H // 2 - 20], fill=AMBER + (60,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(210)))


def wrap_fit(d, text, weight, max_size, max_w):
    """Retorna (linhas, fonte) cabendo em max_w (ate 2 linhas)."""
    size = max_size
    while size > 40:
        fnt = font(weight, size)
        if d.textlength(text, font=fnt) <= max_w:
            return [text], fnt
        # tenta quebrar em 2 linhas
        words = text.split()
        for k in range(1, len(words)):
            l1 = " ".join(words[:k]); l2 = " ".join(words[k:])
            if d.textlength(l1, font=fnt) <= max_w and d.textlength(l2, font=fnt) <= max_w:
                return [l1, l2], fnt
        size -= 3
    return [text], font(weight, size)


def make_title_card(path, title, subtitle):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    bg_base(d, img)
    # escudo pequeno acima do texto
    sym = recolor_amber(trim(Image.open(os.path.join(ASSETS, "agillock_new_symbol.png")).convert("RGBA")))
    sh = 150; sw = int(sym.width * sh / sym.height)
    img.alpha_composite(sym.resize((sw, sh), Image.LANCZOS), ((W - sw) // 2, int(H * 0.33)))
    # titulo (centralizado, ate 2 linhas)
    lines, fnt = wrap_fit(d, title, "ExtraBold", 96, W - 140)
    asc, desc = fnt.getmetrics(); lh = asc + desc
    y = int(H * 0.43)
    for ln in lines:
        d.text(((W - d.textlength(ln, font=fnt)) / 2, y), ln, font=fnt, fill=(255, 255, 255))
        y += lh
    # linha ambar
    d.rounded_rectangle([W // 2 - 60, y + 16, W // 2 + 60, y + 26], radius=5, fill=AMBER)
    # subtitulo
    fs = font("Medium", 42)
    d.text(((W - d.textlength(subtitle, font=fs)) / 2, y + 50), subtitle, font=fs, fill=(205, 210, 218))
    img.convert("RGB").save(path)


def make_card(path, kind):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    bg_base(d, img)
    logo = trim(Image.open(os.path.join(ASSETS, "logo_agillock_white_new.png")).convert("RGBA"))
    lw = int(W * 0.74); lh = int(lw * logo.height / logo.width)
    img.alpha_composite(logo.resize((lw, lh), Image.LANCZOS), ((W - lw) // 2, int(H * 0.37)))
    if kind == "intro":
        msg = "Gestão de rastreamento da sua frota"
        fnt = font("Medium", 46)
        d.text(((W - d.textlength(msg, font=fnt)) / 2, int(H * 0.37) + lh + 44), msg, font=fnt, fill=(210, 215, 222))
    else:
        msg = "Baixe agora"; fnt = font("Bold", 72)
        d.text(((W - d.textlength(msg, font=fnt)) / 2, int(H * 0.37) + lh + 40), msg, font=fnt, fill=AMBER)
        sub = "Disponível para iOS e Android"; fs = font("Medium", 40)
        d.text(((W - d.textlength(sub, font=fs)) / 2, int(H * 0.37) + lh + 132), sub, font=fs, fill=(210, 215, 222))
    img.convert("RGB").save(path)


def still_clip(png, dur, out):
    run([FFMPEG, "-y", "-loglevel", "error", "-loop", "1", "-t", str(dur), "-i", png,
         "-vf", f"scale={W}:{H},fps={FPS},setsar=1,format=yuv420p", "-c:v", "libx264", out])


def footage_clip(start, dur, out):
    run([FFMPEG, "-y", "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", SRC,
         "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1,format=yuv420p",
         "-an", "-c:v", "libx264", out])


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="promo2_")
    clips, durs, trans = [], [], []

    intro = os.path.join(tmp, "intro.mp4"); make_card(os.path.join(tmp, "intro.png"), "intro")
    still_clip(os.path.join(tmp, "intro.png"), INTRO_DUR, intro)
    clips.append(intro); durs.append(INTRO_DUR)

    for i, (title, sub, start, dur) in enumerate(FEATURES):
        tp = os.path.join(tmp, f"t{i}.png"); make_title_card(tp, title, sub)
        tc = os.path.join(tmp, f"t{i}.mp4"); still_clip(tp, TITLE_DUR, tc)
        trans.append(("fade", 0.4) if i == 0 else ("slideleft", 0.5))  # entra no titulo
        clips.append(tc); durs.append(TITLE_DUR)
        fc = os.path.join(tmp, f"f{i}.mp4"); footage_clip(start, dur, fc)
        trans.append(("fade", 0.3))  # titulo -> footage
        clips.append(fc); durs.append(dur)
    trans.append(("fade", 0.5))  # ultima footage -> outro

    outro = os.path.join(tmp, "outro.mp4"); make_card(os.path.join(tmp, "outro.png"), "outro")
    still_clip(os.path.join(tmp, "outro.png"), OUTRO_DUR, outro)
    clips.append(outro); durs.append(OUTRO_DUR)

    # encadeia com transicoes variadas
    inputs = []
    for c in clips:
        inputs += ["-i", c]
    filt = []; prev = "[0:v]"; acc = durs[0]
    for i in range(1, len(clips)):
        ttype, tdur = trans[i - 1]
        off = acc - tdur
        out = f"[v{i}]"
        filt.append(f"{prev}[{i}:v]xfade=transition={ttype}:duration={tdur}:offset={off:.3f}{out}")
        prev = out
        acc = acc + durs[i] - tdur
    total = acc

    # trilha com fade in/out
    midx = len(clips)
    inputs += ["-i", MUSIC]
    afilter = (f"[{midx}:a]afade=t=in:st=0:d=1.2,"
               f"afade=t=out:st={total - 1.8:.3f}:d=1.8,volume=0.85[aout]")
    filter_complex = ";".join(filt) + ";" + afilter

    run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", filter_complex,
         "-map", prev, "-map", "[aout]", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT])
    print("salvo:", OUT, f"(~{total:.1f}s)")


if __name__ == "__main__":
    main()
