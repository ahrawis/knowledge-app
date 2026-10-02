"""Gera icons/icon-192.png e icons/icon-512.png: ficha branca com linhas sobre azul.

Só biblioteca padrão. Sintaxe compatível com Python 3.8.
"""
import os
import struct
import zlib
from typing import Tuple

AZUL = (0x24, 0x56, 0xA6)
BRANCO = (0xFF, 0xFF, 0xFF)
LINHA = (0xB9, 0xC6, 0xDE)


def cor(x: int, y: int, s: int) -> Tuple[int, int, int]:
    # ficha dentro da área segura de ícone maskable (80% central)
    x0, x1, y0, y1 = s * 0.27, s * 0.73, s * 0.30, s * 0.70
    if not (x0 <= x < x1 and y0 <= y < y1):
        return AZUL
    rel = (y - y0) / (y1 - y0)
    for alvo, fim in ((0.25, 0.85), (0.45, 0.85), (0.65, 0.60)):
        if abs(rel - alvo) < 0.035 and x0 + s * 0.06 <= x < x0 + (x1 - x0) * fim:
            return LINHA if alvo > 0.3 else AZUL
    return BRANCO


def png(s: int) -> bytes:
    linhas = b"".join(b"\x00" + bytes(c for x in range(s) for c in cor(x, y, s)) for y in range(s))

    def chunk(tipo: bytes, dados: bytes) -> bytes:
        return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(linhas, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    pasta = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(pasta, exist_ok=True)
    for s in (192, 512):
        with open(os.path.join(pasta, "icon-%d.png" % s), "wb") as f:
            f.write(png(s))
    print("ok")
