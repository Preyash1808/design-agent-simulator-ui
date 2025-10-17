#!/usr/bin/env python3
"""
Corrected div analysis with proper self-closing detection.
"""
import re

file_path = r"C:\Users\p1889\Desktop\Persona\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\ui\src\app\reports\page.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.split('\n')

def is_self_closing_div(line, match_pos):
    """Check if a <div at match_pos is self-closing."""
    # Find the closing > for this div
    rest = line[match_pos:]
    bracket_pos = rest.find('>')
    if bracket_pos == -1:
        return False
    tag_content = rest[:bracket_pos + 1]
    return tag_content.rstrip().endswith('/>')

def count_divs_precise(start_line, end_line):
    """Precisely count divs, excluding self-closing ones."""
    opens = 0
    closes = 0
    open_lines = []

    for line_num in range(start_line, end_line + 1):
        if line_num > len(lines):
            break
        line = lines[line_num - 1]

        # Find all <div tags
        for match in re.finditer(r'<div\b', line):
            if not is_self_closing_div(line, match.start()):
                opens += 1
                open_lines.append(line_num)

        # Count closing tags
        closes += len(re.findall(r'</div>', line))

    return opens, closes, open_lines

# Test on full range
total_opens, total_closes, all_opens = count_divs_precise(1140, 2505)
print(f"FULL RANGE (lines 1140-2505):")
print(f"  Opening <div> tags (non-self-closing): {total_opens}")
print(f"  Closing </div> tags: {total_closes}")
print(f"  Difference: {total_opens - total_closes}")
print()

# Now trace through to find unclosed
print("="*80)
print("STACK TRACE TO FIND UNCLOSED DIVS")
print("="*80)

stack = []
for line_num in range(1140, 2506):
    if line_num > len(lines):
        break
    line = lines[line_num - 1]

    # Add opens to stack
    for match in re.finditer(r'<div\b', line):
        if not is_self_closing_div(line, match.start()):
            stack.append((line_num, line.strip()[:85]))

    # Remove closes from stack
    num_closes = len(re.findall(r'</div>', line))
    for _ in range(num_closes):
        if stack:
            stack.pop()
        else:
            print(f"WARNING: Extra </div> at line {line_num}: {line.strip()[:60]}")

print(f"\nFinal stack size: {len(stack)}")
if stack:
    print(f"\n{len(stack)} UNCLOSED DIVS FOUND:")
    print("-"*80)
    for i, (ln, snippet) in enumerate(stack, 1):
        print(f"{i}. Line {ln}:")
        print(f"   {snippet}")
        print()
