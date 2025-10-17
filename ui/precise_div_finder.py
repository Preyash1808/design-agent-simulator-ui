#!/usr/bin/env python3
"""
Precise div analysis - tracks every single div open/close.
"""
import re

file_path = r"C:\Users\p1889\Desktop\Persona\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\ui\src\app\reports\page.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Count in the full return block
total_opens = 0
total_closes = 0
line_opens = []
line_closes = []

for i in range(1139, 2506):  # Lines 1140-2506
    line = lines[i]
    line_num = i + 1

    # Count opening <div> tags (exclude self-closing)
    opens = 0
    for match in re.finditer(r'<div(?:\s|>)', line):
        # Check if NOT self-closing
        after = line[match.end():]
        rest = after.split('<')[0] if '<' in after else after
        if not re.search(r'/>', rest):
            opens += 1
            line_opens.append(line_num)

    # Count closing </div> tags
    closes = len(re.findall(r'</div>', line))

    if opens > 0:
        total_opens += opens
    if closes > 0:
        total_closes += closes
        line_closes.extend([line_num] * closes)

print(f"Total opening <div> tags: {total_opens}")
print(f"Total closing </div> tags: {total_closes}")
print(f"Difference: {total_opens - total_closes}")
print()

if total_opens != total_closes:
    diff = total_opens - total_closes
    print(f"{'UNCLOSED' if diff > 0 else 'EXTRA CLOSES'}: {abs(diff)}")
    print()

# Now manually track stack to find exact unclosed ones
print("="*80)
print("TRACKING STACK TO FIND UNCLOSED DIVS:")
print("="*80)

stack = []
for i in range(1139, 2506):
    line = lines[i]
    line_num = i + 1

    # Process opens
    for match in re.finditer(r'<div(?:\s|>)', line):
        after = line[match.end():]
        rest = after.split('<')[0] if '<' in after else after
        if not re.search(r'/>', rest):
            stack.append((line_num, line.strip()[:80]))

    # Process closes
    closes = len(re.findall(r'</div>', line))
    for _ in range(closes):
        if stack:
            stack.pop()

print(f"\nFinal stack size: {len(stack)}")
print("\nUnclosed divs:")
for i, (num, snippet) in enumerate(stack, 1):
    print(f"{i}. Line {num}: {snippet}")

# Let's also check if user said they removed 3 extra closes
# The user mentioned removing extra closes around lines 1653, 1807, 1982
print("\n" + "="*80)
print("CHECKING FORMER LOCATIONS OF REMOVED EXTRA CLOSES:")
print("="*80)
check_lines = [1653, 1807, 1982]
for ln in check_lines:
    if ln <= len(lines):
        print(f"Line {ln}: {lines[ln-1].strip()[:100]}")
