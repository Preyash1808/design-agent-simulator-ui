#!/usr/bin/env python3
import json
import pathlib
import platform
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / 'config' / 'figma.config.json'


def read_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def open_url(link: str) -> None:
    system = platform.system().lower()
    try:
        if system == 'darwin':
            subprocess.check_call(['open', link])
        elif system == 'windows':
            subprocess.check_call(['cmd', '/c', 'start', '', link])
        else:
            subprocess.check_call(['xdg-open', link])
        print('Opened Figma link in your default browser.')
    except Exception:
        print(f'Figma link: {link}')


def main():
    config = read_config()
    link = config.get('figmaFileUrl')
    if not link:
        print('No figmaFileUrl found in config/figma.config.json')
        return
    open_url(link)


if __name__ == '__main__':
    main()


