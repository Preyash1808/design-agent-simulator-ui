#!/usr/bin/env python3
"""
Analyze div tag balance in page.tsx to find unclosed divs.
"""
import re

file_path = r"C:\Users\p1889\Desktop\Persona\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\design-agent-simulator-1f465aa4685c5ccddbe38de5e88e15380e523fae\ui\src\app\reports\page.tsx"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Focus on the return statement (lines 1140-2505)
start_line = 1140
end_line = 2505

balance = 0
stack = []  # Track opening divs with their line numbers
issues = []

for i in range(start_line - 1, min(end_line, len(lines))):
    line_num = i + 1
    line = lines[i]

    # Find all <div> opening tags (including self-closing ones)
    opening_divs = re.finditer(r'<div(?:\s|>)', line)
    for match in opening_divs:
        # Check if it's self-closing
        after_match = line[match.end():]
        if not re.search(r'/>', after_match.split('<')[0]):
            balance += 1
            stack.append(line_num)

    # Find all </div> closing tags
    closing_divs = re.findall(r'</div>', line)
    for _ in closing_divs:
        balance -= 1
        if stack:
            stack.pop()

print(f"Analysis from lines {start_line} to {end_line}:")
print(f"Final balance: {balance}")
print(f"Total unclosed divs: {len(stack)}")
print()

if balance > 0:
    print(f"Found {balance} unclosed <div> tags")
    print(f"\nLikely unclosed div locations (last {min(10, len(stack))} in stack):")
    for line_num in stack[-10:]:
        print(f"  Line {line_num}: {lines[line_num-1].strip()[:100]}")
elif balance < 0:
    print(f"Found {abs(balance)} extra </div> closing tags")
else:
    print("All divs are balanced!")

# Now let's do a more detailed section-by-section analysis
print("\n" + "="*80)
print("SECTION-BY-SECTION ANALYSIS")
print("="*80)

sections = [
    (1140, 1220, "Download Modal"),
    (1222, 1264, "Project/Run Selection"),
    (1265, 1290, "Tabs Section"),
    (1290, 1314, "Overview KPIs"),
    (1315, 1458, "Problem Areas Section"),
    (1461, 1638, "UX Audit Section"),
    (1640, 1788, "Recommendations Section"),
    (1790, 1961, "Persona Cards"),
    (1962, 2505, "Persona Detail Modal"),
]

for section_start, section_end, section_name in sections:
    balance = 0
    opens = []
    closes = 0

    for i in range(section_start - 1, min(section_end, len(lines))):
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

    status = "BALANCED" if balance == 0 else f"IMBALANCED ({balance:+d})"
    print(f"\n{section_name} (lines {section_start}-{section_end}):")
    print(f"  Opens: {len(opens)}, Closes: {closes}, Balance: {balance:+d} {status}")

    if balance != 0:
        print(f"  Last few opening divs in this section:")
        for line_num in opens[-5:]:
            print(f"    Line {line_num}: {lines[line_num-1].strip()[:80]}")
