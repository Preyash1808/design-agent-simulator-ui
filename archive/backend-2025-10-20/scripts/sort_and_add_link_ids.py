#!/usr/bin/env python3
"""
Sort enriched prototype links deterministically and add incremental linkId.

Default I/O:
- Input:  logs/prototype_links_enriched.json
- Output: logs/prototype_links_enriched.json (overwrites)

Sort key: (source_screen_name, destination_screen_name, source_element_name, source_element_id)
IDs start at 1.
"""

import json
import argparse
import pathlib
from typing import List, Dict, Any


def sort_links(links: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def key(l: Dict[str, Any]):
        return (
            str(l.get('source_screen_name') or ''),
            str(l.get('destination_screen_name') or ''),
            str(l.get('source_element_name') or ''),
            str(l.get('source_element_id') or ''),
        )
    return sorted(links, key=key)


def main():
    parser = argparse.ArgumentParser(description='Sort enriched links and add linkId')
    parser.add_argument('--input', default='logs/prototype_links_enriched.json')
    parser.add_argument('--out', default='logs/prototype_links_enriched.json')
    args = parser.parse_args()

    inp = pathlib.Path(args.input)
    data: List[Dict[str, Any]] = json.loads(inp.read_text(encoding='utf-8'))
    data = sort_links(data)
    for i, row in enumerate(data, start=1):
        row['linkId'] = int(i)

    outp = pathlib.Path(args.out)
    outp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Updated {len(data)} links with linkId → {outp}')


if __name__ == '__main__':
    main()



