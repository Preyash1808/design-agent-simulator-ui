#!/usr/bin/env python3
"""
Final definitive analysis to find ALL 6 unclosed divs.
"""
import re

file_path = r"C:\Users\p1889\Desktop\Persona\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\ui\src\app\reports\page.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

def count_divs_in_range(start, end):
    """Count opening and closing divs in a range."""
    opens = 0
    closes = 0
    open_lines = []

    for i in range(start - 1, min(end, len(lines))):
        line = lines[i]
        line_num = i + 1

        # Find opening divs
        for match in re.finditer(r'<div(?:\s|>)', line):
            # Check if not self-closing
            after = line[match.end():]
            rest = after.split('<')[0] if '<' in after else after
            close_pos = rest.find('>')
            if close_pos != -1:
                between = rest[:close_pos]
                if '/>' not in between:
                    opens += 1
                    open_lines.append(line_num)

        # Find closing divs
        closes += len(re.findall(r'</div>', line))

    return opens, closes, open_lines

# Define all major sections based on structure
sections = [
    (1141, 1141, "Main card wrapper"),
    (1142, 1168, "Header row with download button"),
    (1170, 1220, "Download modal (conditional)"),
    (1222, 1264, "Project/Run selection grid"),
    (1265, 1269, "Loading spinner (conditional)"),
    (1270, 1286, "Report grid + tabs header"),
    (1288, 1296, "Overview empty state (conditional)"),
    (1297, 1314, "Overview KPIs tile"),
    (1315, 1458, "Problem Areas tile"),
    (1461, 1639, "UX Audit Snapshot tile"),
    (1640, 1788, "Recommendations tile (Overview tab)"),
    (1791, 1961, "Persona Cards tile (Persona tab)"),
    (1962, 2480, "Persona detail modal (conditional)"),
    (2481, 2504, "Image preview modal (conditional)"),
    (2505, 2505, "Close main card wrapper"),
]

print("="*90)
print("SECTION-BY-SECTION DIV ANALYSIS")
print("="*90)
print(f"{'Section':<50} {'Lines':<12} {'Opens':<6} {'Closes':<7} {'Balance':<8} {'Status'}")
print("-"*90)

total_opens = 0
total_closes = 0
issues = []

for start, end, name in sections:
    opens, closes, open_lines = count_divs_in_range(start, end)
    balance = opens - closes
    total_opens += opens
    total_closes += closes

    status = "OK" if balance == 0 else f"ISSUE: {balance:+d}"
    marker = "   " if balance == 0 else ">>>"

    line_range = f"{start}-{end}" if start != end else f"{start}"
    print(f"{marker} {name:<47} {line_range:<10} {opens:<6} {closes:<7} {balance:+3d}       {status}")

    if balance != 0:
        issues.append((name, start, end, balance, open_lines))

print("-"*90)
print(f"{'TOTAL':<47} {'1140-2505':<10} {total_opens:<6} {total_closes:<7} {total_opens - total_closes:+3d}")
print("="*90)

if issues:
    print(f"\nFOUND {len([i for i in issues if i[3] > 0])} SECTIONS WITH UNCLOSED DIVS:")
    print("="*90)

    for name, start, end, balance, open_lines in issues:
        if balance > 0:
            print(f"\n{name} (lines {start}-{end}): {balance} unclosed div(s)")
            if balance <= 3:
                # Show the likely unclosed lines
                print(f"  Likely unclosed at line(s): {', '.join(map(str, open_lines[-balance:]))}")
                for ln in open_lines[-balance:]:
                    print(f"    Line {ln}: {lines[ln-1].strip()[:85]}")

# Now do a complete stack trace
print("\n" + "="*90)
print("COMPLETE STACK TRACE")
print("="*90)

stack = []
for i in range(1139, 2506):
    line = lines[i]
    line_num = i + 1

    # Process opens
    for match in re.finditer(r'<div(?:\s|>)', line):
        after = line[match.end():]
        rest = after.split('<')[0] if '<' in after else after
        close_pos = rest.find('>')
        if close_pos != -1:
            between = rest[:close_pos]
            if '/>' not in between:
                stack.append((line_num, line.strip()[:90]))

    # Process closes
    closes = len(re.findall(r'</div>', line))
    for _ in range(closes):
        if stack:
            stack.pop()

print(f"\nFinal unclosed divs remaining in stack: {len(stack)}")
if stack:
    print("\nThese specific divs are unclosed:")
    for i, (ln, snippet) in enumerate(stack, 1):
        print(f"  {i}. Line {ln}: {snippet}")
