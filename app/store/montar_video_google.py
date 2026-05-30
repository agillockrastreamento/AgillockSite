"""
Monta um video promocional editado (Google Play / YouTube) a partir da
gravacao de tela: card de abertura, cortes por funcionalidade com legenda,
crossfades e card de encerramento.

Saida: store/out/google_promo_editado_1080x2400.mp4
"""
import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "printsevideos")
FONTS = os.path.join(HERE, "fonts")
ASSETS = os.path.join(HERE, "..", "assets")
OUTDIR = os.path.join(HERE, "out")
SRC = os.path.join(RAW, "Screenrecorder-2026-05-30-09-24-56-725.mp4")
OUT = os.path.join(OUTDIR, "google_promo_editado_1080x2400.mp4")
FFMPEG = r"C:\Users\Pedro\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"

W, H = 1080, 2400
FPS = 30
T = 0.5            # duracao do crossfade
AMBER = (245, 166, 35)

from PIL import ImageFont


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f"Montserrat-{weight}.ttf"), size)


def trim(im):
    bb = im.split()[3].getbbox()
    return im.crop(bb) if bb else im


# (legenda, inicio_no_video, duracao)
SEGMENTS = [
    ("Acompanhe em tempo real", 0.5, 4.0),
    ("Trajetos e rotas detalhados", 18.0, 4.0),
    ("Relatórios completos", 42.0, 4.0),
    ("Planos de manutenção", 29.5, 4.0),
    ("Tudo sobre cada veículo", 3.5, 4.0),
]
INTRO_DUR, OUTRO_DUR = 2.6, 3.0


def run(args):
    subprocess.run(args, check=True)


def make_caption_png(text, path):
    """Overlay 1080x2400 transparente com scrim no topo + legenda."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    scrim = Image.new("RGBA", (W, 360), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    for y in range(360):
        sd.line([(0, y), (W, y)], fill=(0, 0, 0, int(180 * (1 - y / 360))))
    img.alpha_composite(scrim, (0, 0))
    d = ImageDraw.Draw(img)
    size = 64
    fnt = font("Bold", size)
    while d.textlength(text, font=fnt) > W - 120 and size > 36:
        size -= 2
        fnt = font("Bold", size)
    tw = d.textlength(text, font=fnt)
    # barrinha ambar + texto
    d.rounded_rectangle([60, 150, 60 + 70, 150 + 8], radius=4, fill=AMBER)
    d.text((60, 175), text, font=fnt, fill=(255, 255, 255))
    img.save(path)


def make_card(path, kind):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    for y in range(H):
        t = y / H
        ImageDraw.Draw(img).line([(0, y), (W, y)],
                                 fill=(int(8 + t * 16), int(12 + t * 22), int(18 + t * 38), 255))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W // 2 - 600, H // 2 - 760, W // 2 + 600, H // 2 - 40], fill=AMBER + (60,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(200)))
    d = ImageDraw.Draw(img)

    logo = trim(Image.open(os.path.join(ASSETS, "logo_agillock_white_new.png")).convert("RGBA"))
    lw = int(W * 0.72)
    lh = int(lw * logo.height / logo.width)
    img.alpha_composite(logo.resize((lw, lh), Image.LANCZOS), ((W - lw) // 2, int(H * 0.36)))

    if kind == "intro":
        msg = "Gestão de rastreamento da sua frota"
        fnt = font("Medium", 46)
        d.text(((W - d.textlength(msg, font=fnt)) / 2, int(H * 0.36) + lh + 40), msg,
               font=fnt, fill=(210, 215, 222))
    else:
        msg = "Baixe agora"
        fnt = font("Bold", 70)
        d.text(((W - d.textlength(msg, font=fnt)) / 2, int(H * 0.36) + lh + 40), msg, font=fnt, fill=AMBER)
        sub = "Disponível para iOS e Android"
        fs = font("Medium", 40)
        d.text(((W - d.textlength(sub, font=fs)) / 2, int(H * 0.36) + lh + 130), sub,
               font=fs, fill=(210, 215, 222))
    img.convert("RGB").save(path)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="promo_")
    clips = []
    durations = []

    # intro
    intro_png = os.path.join(tmp, "intro.png")
    make_card(intro_png, "intro")
    intro_mp4 = os.path.join(tmp, "c_intro.mp4")
    run([FFMPEG, "-y", "-loglevel", "error", "-loop", "1", "-t", str(INTRO_DUR), "-i", intro_png,
         "-vf", f"scale={W}:{H},fps={FPS},setsar=1,format=yuv420p", "-c:v", "libx264", intro_mp4])
    clips.append(intro_mp4); durations.append(INTRO_DUR)

    # segmentos com legenda
    for i, (cap, start, dur) in enumerate(SEGMENTS):
        cap_png = os.path.join(tmp, f"cap{i}.png")
        make_caption_png(cap, cap_png)
        seg_mp4 = os.path.join(tmp, f"c_seg{i}.mp4")
        run([FFMPEG, "-y", "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", SRC,
             "-i", cap_png, "-filter_complex",
             f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1[v];"
             f"[v][1:v]overlay=0:0,format=yuv420p[o]",
             "-map", "[o]", "-an", "-c:v", "libx264", seg_mp4])
        clips.append(seg_mp4); durations.append(dur)

    # outro
    outro_png = os.path.join(tmp, "outro.png")
    make_card(outro_png, "outro")
    outro_mp4 = os.path.join(tmp, "c_outro.mp4")
    run([FFMPEG, "-y", "-loglevel", "error", "-loop", "1", "-t", str(OUTRO_DUR), "-i", outro_png,
         "-vf", f"scale={W}:{H},fps={FPS},setsar=1,format=yuv420p", "-c:v", "libx264", outro_mp4])
    clips.append(outro_mp4); durations.append(OUTRO_DUR)

    # encadeia com crossfade (xfade)
    inputs = []
    for c in clips:
        inputs += ["-i", c]
    filt = []
    prev = "[0:v]"
    acc = durations[0]
    for i in range(1, len(clips)):
        off = acc - T
        out = f"[v{i}]"
        filt.append(f"{prev}[{i}:v]xfade=transition=fade:duration={T}:offset={off:.3f}{out}")
        prev = out
        acc = acc + durations[i] - T
    filter_complex = ";".join(filt)
    run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", filter_complex,
         "-map", prev, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-movflags", "+faststart", OUT])
    print("salvo:", OUT, f"(~{acc:.1f}s)")


if __name__ == "__main__":
    main()
