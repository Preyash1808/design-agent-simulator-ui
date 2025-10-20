#!/usr/bin/env python3
import sys
import pathlib
from PIL import Image, ImageOps

def pad_image(input_path: pathlib.Path, output_path: pathlib.Path, padding: int = 64, color=(255,255,255)):
    img = Image.open(input_path).convert('RGBA')
    # Create background
    bg = Image.new('RGBA', (img.width + 2*padding, img.height + 2*padding), color + (255,))
    bg.paste(img, (padding, padding), img)
    # Convert to opaque RGB on white background
    out = Image.new('RGB', bg.size, color)
    out.paste(bg, mask=bg.split()[3])
    out.save(output_path, format='PNG')

def main():
    if len(sys.argv) < 2:
        print('Usage: pad_image.py <input> [output] [padding]')
        sys.exit(1)
    input_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2]) if len(sys.argv) >= 3 else input_path
    padding = int(sys.argv[3]) if len(sys.argv) >= 4 else 64
    pad_image(input_path, output_path, padding)
    print(f'Saved padded image to {output_path}')

if __name__ == '__main__':
    main()




