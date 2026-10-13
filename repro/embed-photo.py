#!/opt/homebrew/bin/uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""photo -> 28x38 16-level luminance hex string for on-chain embedding.
   the grid is the only form of the photograph that will ever be public."""
import sys
from PIL import Image, ImageOps
GW, GH = 28, 38
def encode(path):
    im = Image.open(path).convert('L')
    im = ImageOps.fit(im, (GW, GH))           # center-crop to sheet aspect
    im = ImageOps.autocontrast(im, cutoff=1)
    px = list(im.getdata())
    return ''.join('%x' % (p * 15 // 255) for p in px)
for p in sys.argv[1:]:
    h = encode(p)
    print(p, len(h))
    print(h)
    # proof sheet: upscale the grid so we can eyeball what survives
    im = Image.new('L', (GW, GH))
    im.putdata([int(c, 16) * 17 for c in h])
    im.resize((GW * 12, GH * 12), Image.NEAREST).save(p.rsplit('.', 1)[0] + '_ghost.png')
