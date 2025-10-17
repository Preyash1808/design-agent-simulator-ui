#!/usr/bin/env python3
"""
Deep dive analysis to find ALL unclosed divs.
"""
import re

file_path = r"C:\Users\p1889\Desktop\Persona\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\ui\src\app\reports\page.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Focus on the return statement (lines 1140-2505)
start_line = 1140
end_line = 2505

# Track every div with its depth
stack = []  # Each item is (line_num, indent_level, snippet)
balance_by_line = []

for i in range(start_line - 1, min(end_line, len(lines))):
    line_num = i + 1
    line = lines[i]
    original_balance = len(stack)

    # Find all <div> opening tags
    opening_divs = re.finditer(r'<div(?:\s|>)', line)
    for match in opening_divs:
        # Check if it's NOT self-closing
        after_match = line[match.end():]
        rest_of_line = after_match.split('<')[0]
        if not re.search(r'/>', rest_of_line):
            snippet = line.strip()[:100]
            indent = len(line) - len(line.lstrip())
            stack.append((line_num, indent, snippet))

    # Find all </div> closing tags
    closing_divs = re.findall(r'</div>', line)
    for _ in closing_divs:
        if stack:
            stack.pop()

    # Track balance changes
    new_balance = len(stack)
    if original_balance != new_balance:
        balance_by_line.append((line_num, new_balance, line.strip()[:80]))

print("FINAL STACK - These divs are UNCLOSED:")
print("=" * 80)
for i, (line_num, indent, snippet) in enumerate(stack, 1):
    print(f"{i}. Line {line_num} (indent {indent}): {snippet}")

print(f"\nTotal unclosed: {len(stack)}")
print()

# Now let's find problematic areas by looking for sudden balance increases
print("POTENTIAL PROBLEM AREAS (where balance increased significantly):")
print("=" * 80)

prev_balance = 0
for line_num, balance, snippet in balance_by_line:
    if balance > prev_balance + 2:  # Significant jump
        print(f"Line {line_num}: Balance jumped to {balance} (was {prev_balance})")
        print(f"  {snippet}")
    prev_balance = balance

# Detailed section-by-section with subsections
print("\n" + "=" * 80)
print("DETAILED SECTION ANALYSIS")
print("=" * 80)

detailed_sections = [
    (1140, 1167, "Download buttons"),
    (1170, 1220, "Download modal"),
    (1222, 1264, "Project/Run selection"),
    (1265, 1269, "Boot loading spinner"),
    (1270, 1286, "Tabs header"),
    (1288, 1296, "Overview - empty state"),
    (1297, 1314, "Overview - KPIs tile"),
    (1315, 1458, "Problem Areas tile"),
    (1461, 1635, "UX Audit tile"),
    (1636, 1639, "End of Overview tab fragment"),
    (1640, 1788, "Recommendations tile (Overview tab)"),
    (1789, 1790, "End of Recommendations section"),
    (1791, 1961, "Persona Cards tile"),
    (1962, 2005, "Persona detail modal - header"),
    (2006, 2100, "Persona detail - Emotion mix"),
    (2101, 2250, "Persona detail - Sentiment/Backtrack"),
    (2251, 2400, "Persona detail - Journey"),
    (2401, 2480, "Persona detail - Thoughts"),
    (2481, 2504, "Image preview modal"),
    (2505, 2506, "Close main return div"),
]

for sec_start, sec_end, name in detailed_sections:
    balance = 0
    opens = []
    closes = 0

    for i in range(sec_start - 1, min(sec_end, len(lines))):
        line = lines[i]

        # Count opening divs
        opening_divs = re.finditer(r'<div(?:\s|>)', line)
        for match in opening_divs:
            after_match = line[match.end():]
            if not re.search(r'/>', after_match.split('<')[0]):
                balance += 1
                opens.append(i + 1)

        # Count closing divs
        closing_divs = re.findall(r'</div>', line)
        closes += len(closing_divs)
        balance -= len(closing_divs)

    status = "OK" if balance == 0 else f"ISSUE: {balance:+d}"
    marker = "  " if balance == 0 else ">>>"
    print(f"{marker} {name:45} ({sec_start:4}-{sec_end:4}): {balance:+3d}  [{status}]")
