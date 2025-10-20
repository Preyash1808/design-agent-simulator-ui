#!/usr/bin/env python3
import sys
import subprocess
import pathlib


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent
    script = root / 'scripts' / 'extract_figma_prototype_links.py'
    cmd = [sys.executable, str(script), *sys.argv[1:]]
    subprocess.run(cmd, check=False)


if __name__ == '__main__':
    main()



