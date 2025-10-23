import io
import pathlib
import textwrap
from typing import Any, Dict, Optional, List
import os
from PIL import Image

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle, PageBreak
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import re

# RUNS will be set by the calling module
RUNS = None

def set_runs_path(runs_path):
    """Set the RUNS path from the calling module"""
    global RUNS
    RUNS = runs_path

# Set beautiful default style for all charts
plt.style.use('default')
matplotlib.rcParams.update({
    'figure.facecolor': 'white',
    'axes.facecolor': 'white',
    'axes.edgecolor': '#e5e7eb',
    'axes.linewidth': 1,
    'axes.grid': True,
    'grid.alpha': 0.3,
    'grid.color': '#e5e7eb',
    'grid.linewidth': 0.5,
    'text.color': '#374151',
    'axes.labelcolor': '#374151',
    'xtick.color': '#374151',
    'ytick.color': '#374151',
    'font.size': 10,
    'axes.titlesize': 14,
    'axes.labelsize': 11,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'legend.fontsize': 10,
})

# Curated, accessible user palette (blue, green, orange first, then diverse hues)
USER_COLORS = [
    '#3B82F6', # blue
    '#22C55E', # green
    '#F59E0B', # amber
    '#A855F7', # violet
    '#06B6D4', # cyan
    '#EF4444', # red
    '#0EA5E9', # sky
    '#84CC16', # lime
    '#F472B6', # pink
    '#7C3AED', # indigo
]

def getUserColor(index: int, total: int) -> str:
    if index < len(USER_COLORS):
        return USER_COLORS[index]
    # Generate distinct colors for additional users
    return f'#{(index * 137 % 256):02x}{(index * 97 % 256):02x}{(index * 71 % 256):02x}'


def build_report_pdf(data: Dict[str, Any], run_id: str, *, section: str = 'overview', persona: Optional[Dict[str, Any]] = None, persona_id: Optional[str] = None) -> bytes:
    """Builds a PDF report.

    Args:
        data: Overview metrics (result of get_run_metrics_public).
        run_id: Run identifier.
        section: 'overview' | 'persona' | 'full'.
        persona: Optional persona detail payload (when including persona section).
        persona_id: Optional persona id for labeling.

    Returns:
        Raw PDF bytes.
    """
    pdf_io = io.BytesIO()
    doc = SimpleDocTemplate(
        pdf_io,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    styles = getSampleStyleSheet()
    story = []

    # Sanitize text to avoid unsupported glyphs in core PDF fonts
    def sanitize_text(text: Optional[str]) -> str:
        if text is None:
            return ''
        s = str(text)
        # Map smart punctuation, dash variants, and invisibles to safe ASCII
        replacements = {
            '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
            '\u201C': '"', '\u201D': '"', '\u201E': '"',
            # Dashes/hyphens/minus variants → ASCII hyphen
            '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-', '\u00AD': '-',
            '\u2026': '...', '\u00B7': '-', '\u2022': '-', '\u2043': '-',
            # Multiplies sign often used as count marker
            '\u00D7': 'x',
            # Spaces and controls
            '\u00A0': ' ', '\u202F': ' ', '\u2009': ' ', '\u200A': ' ',
            '\u200B': '', '\u200C': '', '\u200D': '', '\u200E': '', '\u200F': '', '\u2060': '',
        }
        for uni, ascii_rep in replacements.items():
            # Always replace the actual unicode char directly
                s = s.replace(uni, ascii_rep)
        return s

    # Readable body style (not bold) for descriptions beside images
    if 'ReportBody' not in styles:
        styles.add(ParagraphStyle(
            name='ReportBody',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=12,
            leading=15,
            textColor=colors.HexColor('#111827'),
        ))

    # Beautiful header: Sparrow logo + horizontal line + Test Report title
    from reportlab.graphics.shapes import Drawing, Rect, String

    # Create Sparrow logo (square with rounded corners and 'S')
    # Vector fallback size in points and desired image size in mm
    logo_size = 30
    logo_mm = 18 * mm
    logo_drawing = Drawing(logo_size, logo_size)

    # Create rounded rectangle for logo background (dark badge with light border)
    logo_bg = Rect(2, 2, logo_size-4, logo_size-4,
                   fillColor=colors.HexColor('#111827'),
                   strokeColor=colors.HexColor('#0f172a'),
                   strokeWidth=1)
    # Rounded corners like navbar badge
    logo_bg.rx = 8
    logo_bg.ry = 8
    logo_drawing.add(logo_bg)

    # Inner border for subtle depth
    inner_bg = Rect(3.5, 3.5, logo_size-7, logo_size-7,
                    fillColor=None,
                    strokeColor=colors.HexColor('#e5e7eb'),
                    strokeWidth=0.8)
    inner_bg.rx = 7
    inner_bg.ry = 7
    logo_drawing.add(inner_bg)

    # Add 'S' text centered precisely using font metrics for vertical centering
    font_name = 'Helvetica-Bold'
    font_size = 16
    ascent = pdfmetrics.getAscent(font_name) / 1000.0 * font_size
    descent = pdfmetrics.getDescent(font_name) / 1000.0 * font_size  # typically negative
    inner_height = logo_size - 4  # inside the 2px border on top/bottom
    # Position baseline so text bounding box is vertically centered in inner square
    baseline_y = 2 + (inner_height - (ascent - descent)) / 2 - descent
    s_text = String(logo_size/2, baseline_y, 'S',
                   textAnchor='middle',
                   fontSize=font_size,
                   fillColor=colors.white,
                   fontName=font_name)
    # slight italic/lean to match brand mark
    try:
        s_text.angle = -14
    except Exception:
        pass
    logo_drawing.add(s_text)

    # Prefer custom logo image if provided (env REPORT_LOGO_PATH or config/logo_p.png, logo_pdf.png, logo.[png|jpg])
    logo_el = None
    try:
        ROOT = pathlib.Path(__file__).resolve().parent.parent
        logo_env = os.environ.get('REPORT_LOGO_PATH')
        candidate_paths = []
        if logo_env:
            candidate_paths.append(pathlib.Path(logo_env))
        # Prefer provided cropped-friendly source first
        candidate_paths.append(ROOT / 'config' / 'logo_p.png')
        # Then explicit PDF-ready logo
        candidate_paths.append(ROOT / 'config' / 'logo_pdf.png')
        candidate_paths.append(ROOT / 'config' / 'logo.png')
        candidate_paths.append(ROOT / 'config' / 'logo.jpg')

        def _load_cropped_logo_image(fp: pathlib.Path) -> Optional[io.BytesIO]:
            try:
                with Image.open(fp) as im:
                    im = im.convert('RGBA')
                    # Find the largest bright region (the white rounded square)
                    gray = im.convert('L')
                    mask = gray.point(lambda p: 255 if p > 200 else 0)
                    bbox = mask.getbbox()
                    if bbox is None:
                        return None
                    # Add a small padding around the detected box
                    left, top, right, bottom = bbox
                    pad = int(min(im.size) * 0.01)
                    left = max(0, left - pad)
                    top = max(0, top - pad)
                    right = min(im.size[0], right + pad)
                    bottom = min(im.size[1], bottom + pad)
                    crop = im.crop((left, top, right, bottom))
                    out = io.BytesIO()
                    crop.save(out, format='PNG')
                    out.seek(0)
                    return out
            except Exception:
                return None
        for fp in candidate_paths:
            try:
                if fp and fp.exists():
                    if fp.name.lower() == 'logo_p.png':
                        logo_buf = _load_cropped_logo_image(fp)
                        if logo_buf is not None:
                            logo_el = RLImage(logo_buf, width=logo_mm, height=logo_mm)
                        else:
                            logo_el = RLImage(str(fp), width=logo_mm, height=logo_mm)
                    else:
                        logo_el = RLImage(str(fp), width=logo_mm, height=logo_mm)
                    break
            except Exception:
                continue
    except Exception:
        logo_el = None
    if logo_el is None:
        logo_el = logo_drawing

    # Create Sparrow brand text as a vector drawing so vertical centering
    # matches the logo exactly
    brand_text = 'Sparrow'
    brand_font = 'Helvetica-Bold'  # bold, non-italic like screenshot
    brand_font_size = 28
    brand_width = pdfmetrics.stringWidth(brand_text, brand_font, brand_font_size)
    brand_drawing = Drawing(brand_width, logo_size)
    brand_ascent = pdfmetrics.getAscent(brand_font) / 1000.0 * brand_font_size
    brand_descent = pdfmetrics.getDescent(brand_font) / 1000.0 * brand_font_size
    brand_baseline_y = (logo_size - (brand_ascent - brand_descent)) / 2 - brand_descent
    brand_string = String(
        0,
        brand_baseline_y,
        brand_text,
        textAnchor='start',
        fontSize=brand_font_size,
        fillColor=colors.HexColor('#0f172a'),
        fontName=brand_font,
    )
    brand_drawing.add(brand_string)

    # Create header table with logo and brand
    header_table = Table(
        [[logo_el, brand_drawing]],
        colWidths=[logo_mm, brand_width],
        rowHeights=[max(logo_size, logo_mm)],
    )
    header_table.hAlign = 'LEFT'
    header_table.setStyle(
        TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('LEFTPADDING', (1, 0), (1, 0), 8),  # moderate gap as in screenshot
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ])
    )
    story.append(header_table)
    story.append(Spacer(1, 8))

    # Add left-aligned accent rule under the brand
    line_table = Table([['']], colWidths=[doc.width])
    line_table.hAlign = 'LEFT'
    line_table.setStyle(
        TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1.0, colors.black),  # thin black rule
        ])
    )
    story.append(line_table)
    story.append(Spacer(1, 12))

    # Create attractive "Test Report" title
    title_style = styles['Title']
    title_style.textColor = colors.HexColor('#1f2937')  # Dark gray
    title_style.fontSize = 36  # larger, left-aligned like screenshot
    title_style.fontName = 'Helvetica-Bold'
    title_style.spaceAfter = 8
    title_style.alignment = 0  # Left alignment

    story.append(Paragraph('<b>Test Report</b>', title_style))
    # Subtle left accent line under the title
    accent = Table([['']], colWidths=[doc.width * 0.26])
    accent.hAlign = 'LEFT'
    accent.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 1.4, colors.HexColor('#d1d5db')),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    story.append(accent)
    story.append(Spacer(1, 10))

    # Helper to add the Overview section
    def add_overview_section():
        # KPI table with beautiful white background styling
        meta = data.get('headline') or {}
        kpi_rows = [
            ['Completion Rate', f"{meta.get('completionRatePct', 0):.1f}%" if meta.get('completionRatePct') is not None else '-'],
            ['Early-Exit Rate', f"{meta.get('earlyExitPct', 0):.1f}%" if meta.get('earlyExitPct') is not None else '-'],
            ['Backtrack Rate', f"{meta.get('backtrackRate', 0):.4f}" if meta.get('backtrackRate') is not None else '-'],
            ['Ideal Steps', str(meta.get('idealSteps') if meta.get('idealSteps') is not None else '-')],
            ['Avg Steps (Completed)', f"{meta.get('avgSteps', 0):.1f}" if meta.get('avgSteps') is not None else '-'],
        ]
        tbl_kpi = Table([['Metric', 'Value'], *kpi_rows], colWidths=[70 * mm, 108 * mm])
        tbl_kpi.setStyle(
            TableStyle(
                [
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2563eb')),  # Blue header
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#1f2937')),  # Dark text
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),  # Light grid
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),  # White alternating rows
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, 0), 12),
                    ('FONTSIZE', (0, 1), (-1, -1), 10),
                    ('LEFTPADDING', (0, 0), (-1, -1), 8),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                    ('TOPPADDING', (0, 0), (-1, -1), 6),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(tbl_kpi)
        story.append(Spacer(1, 10))

    # Conditionally render sections
    if section in ('overview', 'full'):
        add_overview_section()

    # Beautiful Pareto chart with white background (Overview)
    try:
        if section not in ('overview', 'full'):
            raise Exception('skip overview section')
        issues = data.get('issues') or []
        labels = [i.get('label') for i in issues][:8]
        values = [int(i.get('count') or 0) for i in issues][:8]
        if labels and values:
            # Create beautiful chart with modern styling
            fig, ax = plt.subplots(figsize=(7, 4))

            # Color palette for bars
            colors_list = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#f3f4f6', '#e5e7eb', '#d1d5db']

            bars = ax.barh(labels[::-1], values[::-1], color=colors_list[:len(labels)])

            # Beautiful styling
            ax.set_title('Friction Analysis (Pareto Chart)', fontsize=14, fontweight='bold', color='#1f2937', pad=20)
            ax.set_xlabel('Frequency', fontsize=11, color='#374151')
            ax.set_ylabel('Friction Types', fontsize=11, color='#374151')

            # White background and clean styling
            fig.patch.set_facecolor('white')
            ax.set_facecolor('white')
            ax.tick_params(colors='#374151', labelsize=10)

            # Clean spines
            for spine in ax.spines.values():
                spine.set_color('#e5e7eb')
                spine.set_linewidth(1)

            # Add value labels on bars
            for i, (bar, value) in enumerate(zip(bars, values[::-1])):
                if value > 0:
                    ax.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height()/2,
                           str(value), ha='left', va='center', fontsize=9, color='#374151')

            # Grid for better readability
            ax.grid(True, alpha=0.3, color='#e5e7eb', linestyle='-', linewidth=0.5)
            ax.set_axisbelow(True)

            img_buf = io.BytesIO()
            plt.tight_layout()
            fig.savefig(img_buf, format='png', dpi=300, facecolor='white', edgecolor='none', bbox_inches='tight')
            plt.close(fig)
            img_buf.seek(0)
            story.append(Spacer(1, 6))
            story.append(RLImage(img_buf, width=170 * mm, height=90 * mm))
            story.append(Spacer(1, 10))
    except Exception:
        pass

    # Beautiful Severity Distribution chart with white background (Overview)
    try:
        if section not in ('overview', 'full'):
            raise Exception('skip overview section')
        issues_src = (data.get('issues') or [])[:8]
        s = [i.get('sharePct', 0) for i in issues_src]
        # Use actual issue labels instead of generic Type 1/2/3
        labels = []
        for i in issues_src:
            raw = str(i.get('label') or '')
            label = raw.replace('Cta', 'CTA').replace('cta', 'CTA')
            labels.append(sanitize_text(label) or '-')
        if s:
            fig, ax = plt.subplots(figsize=(7, 3.5))

            # Create severity gradient colors (red to green)
            severity_colors = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#16a34a', '#059669', '#0d9488']

            bars = ax.bar(range(len(s)), s, color=severity_colors[:len(s)], alpha=0.8, edgecolor='white', linewidth=1)

            # Beautiful styling
            ax.set_title('Severity Distribution by Issue Type', fontsize=14, fontweight='bold', color='#1f2937', pad=20)
            ax.set_xlabel('Issue Types', fontsize=11, color='#374151')
            ax.set_ylabel('Severity Score (%)', fontsize=11, color='#374151')

            # Set x-axis labels to real issue labels (horizontal, wrapped)
            ax.set_xticks(range(len(s)))
            wrapped_labels = [textwrap.fill(lbl, width=18) for lbl in labels]
            ax.set_xticklabels(wrapped_labels, rotation=0, ha='center')

            # White background and clean styling
            fig.patch.set_facecolor('white')
            ax.set_facecolor('white')
            ax.tick_params(colors='#374151', labelsize=10)

            # Clean spines
            for spine in ax.spines.values():
                spine.set_color('#e5e7eb')
                spine.set_linewidth(1)

            # Add value labels on bars
            for i, (bar, value) in enumerate(zip(bars, s)):
                if value > 0:
                    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                           f'{value:.1f}%', ha='center', va='bottom', fontsize=9, color='#374151', fontweight='bold')

            # Grid for better readability
            ax.grid(True, alpha=0.3, color='#e5e7eb', linestyle='-', linewidth=0.5, axis='y')
            ax.set_axisbelow(True)

            # Set y-axis to show percentages
            ax.set_ylim(0, max(s) * 1.1 if s else 100)

            img_buf = io.BytesIO()
            plt.tight_layout()
            fig.savefig(img_buf, format='png', dpi=300, facecolor='white', edgecolor='none', bbox_inches='tight')
            plt.close(fig)
            img_buf.seek(0)
            story.append(RLImage(img_buf, width=170 * mm, height=80 * mm))
            story.append(Spacer(1, 10))
    except Exception:
        pass

    # Problem screens section: large image + concise description per screen (Overview)
    try:
        if section not in ('overview', 'full'):
            raise Exception('skip overview section')
        import requests
    except Exception:
        requests = None  # type: ignore
    try:
        def _find_local_screen_by_name(file_name: str) -> Optional[pathlib.Path]:
            try:
                base = RUNS if isinstance(RUNS, pathlib.Path) else None
                # Prefer current run directory first for performance
                if base is not None:
                    p1 = base / run_id / 'preprocess' / 'screens' / file_name
                    if p1.exists():
                        return p1
                    # Fallback: any run that contains this file under preprocess/screens
                    for p in base.rglob(file_name):
                        try:
                            if 'preprocess' in p.parts and 'screens' in p.parts and p.is_file():
                                return p
                        except Exception:
                            continue
            except Exception:
                return None
            return None

        def fetch_img(src: Optional[str]) -> Optional[io.BytesIO]:
            if not src:
                return None
            try:
                # Handle server-served relative URLs by resolving to filesystem
                if src.startswith('/runs-files/') and RUNS is not None:
                    rel = src[len('/runs-files/'):]
                    p = (RUNS / rel) if isinstance(RUNS, pathlib.Path) else None
                    if p and p.exists():
                        return io.BytesIO(p.read_bytes())
                if src.startswith('http://') or src.startswith('https://'):
                    if requests is None:  # type: ignore
                        # Best-effort local lookup by filename
                        fname = src.split('/')[-1].split('?')[0]
                        fp = _find_local_screen_by_name(fname)
                        if fp and fp.exists():
                            return io.BytesIO(fp.read_bytes())
                        return None
                    r = requests.get(src, timeout=10)  # type: ignore
                    if r.ok:
                        return io.BytesIO(r.content)
                    # Fallback: locate by filename locally
                    fname = src.split('/')[-1].split('?')[0]
                    fp = _find_local_screen_by_name(fname)
                    if fp and fp.exists():
                        return io.BytesIO(fp.read_bytes())
                    return None
                p = pathlib.Path(src)  # type: ignore
                if p.exists():
                    return io.BytesIO(p.read_bytes())
                # Final fallback: try filename-only local search
                try:
                    fname = pathlib.Path(src).name
                    fp = _find_local_screen_by_name(fname)
                    if fp and fp.exists():
                        return io.BytesIO(fp.read_bytes())
                except Exception:
                    pass
                return None
            except Exception:
                return None

        ps = (data.get('problemScreens') or [])[:3]
        if ps:
            story.append(Spacer(1, 6))
            story.append(Paragraph('<b>Most Problematic Screens</b>', styles['Heading2']))
            story.append(Spacer(1, 4))

            for idx, it in enumerate(ps, start=1):
                name = sanitize_text(it.get('name') or it.get('screenId') or f'Screen {idx}')
                story.append(Paragraph(name, styles['Heading3']))

                # Row: big image on left, problems on right
                img_src = str(it.get('image') or '')
                img_buf = fetch_img(img_src)
                if img_buf:
                    try:
                        # Fit image into a 90mm x 60mm box while preserving aspect ratio
                        max_w = 90 * mm
                        max_h = 60 * mm
                        img_buf.seek(0)
                        iw, ih = ImageReader(img_buf).getSize()
                        # Guard against invalid dimensions
                        if not iw or not ih:
                            width, height = max_w, max_h
                        else:
                            aspect = float(iw) / float(ih)
                            box_aspect = float(max_w) / float(max_h)
                            if box_aspect > aspect:
                                # Height-bound
                                height = max_h
                                width = height * aspect
                            else:
                                # Width-bound
                                width = max_w
                                height = width / aspect
                        img_buf.seek(0)
                        img_el = RLImage(img_buf, width=width, height=height)
                    except Exception:
                        # Fallback to fixed size if anything goes wrong
                        img_buf.seek(0)
                        img_el = RLImage(img_buf, width=90 * mm, height=60 * mm)
                else:
                    img_el = Paragraph('No image available', styles['Italic'])

                # Right-hand side: concise humanized description (sanitized)
                desc_text = sanitize_text(it.get('description') or 'Users encountered friction here. Provide a clearer next step.')
                bullets = [Paragraph(desc_text, styles['ReportBody'])]

                # Wrap bullets in a table cell for layout
                right_tbl = Table([[b] for b in bullets], colWidths=[80 * mm])
                right_tbl.setStyle(TableStyle([
                    ('LEFTPADDING', (0, 0), (-1, -1), 4),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                    ('TOPPADDING', (0, 0), (-1, -1), 2),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                ]))

                row = Table([[img_el, right_tbl]], colWidths=[92 * mm, 86 * mm])
                row.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (0, -1), 'MIDDLE'),  # image centered
                    ('VALIGN', (1, 0), (1, -1), 'TOP'),     # text aligned to top
                    ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
                    ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#ffffff')),
                ]))
                story.append(row)
                story.append(Spacer(1, 8))
    except Exception:
        pass

    # Top Drop-off Reasons section: show all with count and description (Overview)
    try:
        if section not in ('overview', 'full'):
            raise Exception('skip overview section')
        reasons = list(data.get('dropoffReasons') or [])
        if reasons:
            story.append(Spacer(1, 10))
            # Use a standard ASCII hyphen to avoid missing glyph box rendering
            story.append(Paragraph('<b>Top Drop-off Reasons</b>', styles['Heading2']))
            story.append(Spacer(1, 4))

            def _humanize_label(label: str) -> str:
                s = (label or '')
                s = re.sub(r"[_\-]+", " ", s).strip()
                s = " ".join(s.split()).title()
                s = re.sub(r"\bCta\b", "CTA", s)
                s = re.sub(r"\bUi\b", "UI", s)
                s = re.sub(r"\bApi\b", "API", s)
                return s

            def describe_reason(label: str) -> str:
                key = (label or '').strip().lower()
                key = key.replace('-', ' ').replace('_', ' ')
                if 'back or close' in key:
                    return 'Users tried to go back or close, signaling hesitation or confusion. Clarify the next step and reduce commitment anxiety.'
                if 'auto wait' in key or 'auto-advance' in key or 'auto advancing' in key:
                    return 'Users hesitated or waited for the interface to advance, indicating uncertainty or missing feedback.'
                if 'unclear primary' in key or 'cta' in key:
                    return "The primary action isn't obvious at a glance. Emphasize the main CTA and de-emphasize secondary options."
                if 'loop' in key:
                    return 'Users looped between screens without progress. Offer a direct path forward and prevent dead-ends.'
                if 'too many steps' in key:
                    return 'Observed paths are longer than ideal. Provide a more direct route or combine steps to reduce effort.'
                return 'Users encountered friction here. Provide a clearer next step or stronger feedback.'

            # Sort by count desc and render each as a small card row
            reasons = sorted(reasons, key=lambda x: int(x.get('count') or 0), reverse=True)
            accent_colors = ['#22d3ee', '#34d399', '#a78bfa', '#f59e0b', '#f472b6']
            for idx, r in enumerate(reasons):
                label_raw = str(r.get('label') or '')
                label = sanitize_text(_humanize_label(label_raw))
                count = int(r.get('count') or 0)
                # Card-like container matching UI: left accent bar, label, count pill
                title_el = Paragraph(f'<b>{label}</b>', styles['Heading3'])
                count_el = Paragraph(sanitize_text(f'x{count}'), styles['Normal'])
                head = Table([["", title_el, count_el]], colWidths=[3 * mm, 147 * mm, 28 * mm])
                head.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('ALIGN', (2, 0), (2, 0), 'CENTER'),
                    # Accent bar
                    ('BACKGROUND', (0, 0), (0, 0), colors.HexColor(accent_colors[idx % len(accent_colors)])),
                    # Count pill (light theme)
                    ('BACKGROUND', (2, 0), (2, 0), colors.HexColor('#f3f4f6')),
                    ('TEXTCOLOR', (2, 0), (2, 0), colors.HexColor('#111827')),
                    ('BOX', (2, 0), (2, 0), 0.5, colors.HexColor('#d1d5db')),
                    # Card outline
                    ('BOX', (0, 0), (-1, -1), 0.25, colors.HexColor('#e5e7eb')),
                    ('LEFTPADDING', (1, 0), (1, 0), 6),
                    ('RIGHTPADDING', (1, 0), (1, 0), 6),
                    ('LEFTPADDING', (2, 0), (2, 0), 8),
                    ('RIGHTPADDING', (2, 0), (2, 0), 8),
                ]))
                story.append(head)
                story.append(Spacer(1, 2))
                story.append(Paragraph(sanitize_text(describe_reason(label)), styles['ReportBody']))
                story.append(Spacer(1, 6))
    except Exception:
        pass

    # NEW SECTIONS: TEA, Recommendations, Sentiment Drift, Flow Insights

    # 1. Think-Emotion-Action (TEA) Section - 3 unique screens with diverse sentiments
    try:
        if section in ('overview', 'full'):
            import datetime
            print(f"\n{'='*80}")
            print(f"[TEA DEBUG {datetime.datetime.now()}] Starting TEA section generation")
            print(f"{'='*80}")

            tea_thoughts = data.get('tea_thoughts') or []
            unique_teas = data.get('unique_teas') or []
            print(f"[TEA DEBUG] Total tea_thoughts available: {len(tea_thoughts)}")

            # Get TEAs with sentiment scores and unique screens
            all_teas = []
            seen_screens = set()

            for tea in tea_thoughts[:50]:  # Check first 50 to get variety
                try:
                    sentiment = float(tea.get('sentiment', 0))
                    img_src = tea.get('image', '')

                    # Only include TEAs with sentiment and unique screens
                    if sentiment != 0 and img_src and img_src not in seen_screens:
                        all_teas.append({
                            'thought': tea.get('thought', ''),
                            'emotion': tea.get('emotion', ''),
                            'action': tea.get('action', ''),
                            'sentiment': sentiment,
                            'screen': tea.get('screen', ''),
                            'image': img_src
                        })
                        seen_screens.add(img_src)
                except:
                    continue

            print(f"[TEA DEBUG] Unique TEAs collected: {len(all_teas)}")

            if len(all_teas) >= 3:
                print(f"[TEA DEBUG] ✓ Adding TEA section to PDF (3 unique screens)")
                story.append(PageBreak())
                story.append(Paragraph('<b>Think-Emotion-Action (TEA)</b>', styles['Heading2']))
                story.append(Paragraph('<i>Displaying 3 unique user experiences</i>', styles['Normal']))
                story.append(Spacer(1, 8))
            else:
                print(f"[TEA DEBUG] ✗ Not enough unique TEAs ({len(all_teas)} < 3), skipping section")

                # Sort by sentiment to get range
                all_teas_sorted = sorted(all_teas, key=lambda x: x['sentiment'])

                # Select 3 diverse TEAs: 1 most negative, 1 neutral/mid-range, 1 most positive
                selected_teas = []

                # Get most negative
                if len(all_teas_sorted) > 0:
                    selected_teas.append(all_teas_sorted[0])

                # Get mid-range (neutral or mixed sentiment)
                if len(all_teas_sorted) > 2:
                    mid_idx = len(all_teas_sorted) // 2
                    selected_teas.append(all_teas_sorted[mid_idx])

                # Get most positive
                if len(all_teas_sorted) > 1:
                    selected_teas.append(all_teas_sorted[-1])

                print(f"[TEA DEBUG] Selected {len(selected_teas)} TEAs for display")
                for i, tea in enumerate(selected_teas, 1):
                    print(f"[TEA DEBUG]   TEA {i}: sentiment={tea.get('sentiment'):.2f}, screen={tea.get('screen', 'N/A')[:40]}")

                # Display TEAs without section headers, just colored backgrounds
                for idx, tea in enumerate(selected_teas, 1):
                    sentiment = tea.get('sentiment', 0)

                    # Determine background color based on sentiment
                    if sentiment < -0.3:
                        bg_color = colors.HexColor('#fff5f5')  # Light red for negative
                        color_name = "red (negative)"
                    elif sentiment > 0.3:
                        bg_color = colors.HexColor('#f0fdf4')  # Light green for positive
                        color_name = "green (positive)"
                    else:
                        bg_color = colors.HexColor('#fefce8')  # Light yellow for neutral
                        color_name = "yellow (neutral)"

                    print(f"[TEA DEBUG] Displaying TEA {idx} with {color_name} background")

                    img_buf = fetch_img(tea.get('image'))
                    if img_buf:
                        try:
                            img_buf.seek(0)
                            img_el = RLImage(img_buf, width=60 * mm, height=40 * mm)
                        except:
                            img_el = Paragraph('No image', styles['Normal'])
                    else:
                        img_el = Paragraph('No image', styles['Normal'])

                    text_content = f"<b>Think:</b> {sanitize_text(tea.get('thought', 'N/A'))}<br/>"
                    text_content += f"<b>Emotion:</b> {sanitize_text(tea.get('emotion', 'N/A'))}<br/>"
                    text_content += f"<b>Action:</b> {sanitize_text(tea.get('action', 'N/A'))}<br/>"
                    text_content += f"<b>Sentiment:</b> {tea.get('sentiment', 0):.2f}"

                    text_el = Paragraph(text_content, styles['ReportBody'])

                    row = Table([[img_el, text_el]], colWidths=[65 * mm, 113 * mm])
                    row.setStyle(TableStyle([
                        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
                        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
                        ('LEFTPADDING', (0, 0), (-1, -1), 8),
                        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                        ('TOPPADDING', (0, 0), (-1, -1), 8),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                    ]))
                    story.append(row)
                    story.append(Spacer(1, 8))
    except Exception as e:
        print(f"Error adding TEA section: {e}")
        pass

    # 2. Recommendations Section - 6-8 most critical issues across 3 screens
    try:
        if section in ('overview', 'full'):
            import datetime
            print(f"\n{'='*80}")
            print(f"[REC DEBUG {datetime.datetime.now()}] Starting Recommendations section generation")
            print(f"{'='*80}")

            recommendations = data.get('derived_recommendations') or []
            print(f"[REC DEBUG] Total recommendations: {len(recommendations)}")
            if recommendations and len(recommendations) > 0:
                # Debug: print first few recommendations
                for i, rec in enumerate(recommendations[:3]):
                    print(f"[REC DEBUG] Rec {i}: count={rec.get('count')}, image={rec.get('image', '')[:50]}, text={rec.get('text', '')[:80]}")

                story.append(PageBreak())
                story.append(Paragraph('<b>Recommendations</b>', styles['Heading2']))
                story.append(Paragraph('<i>Displaying 6-8 most critical issues across 3 different screens</i>', styles['Normal']))
                story.append(Spacer(1, 8))
                print(f"[REC DEBUG] ✓ Added section header to PDF")

                # Helper function to clean recommendation text
                def clean_rec_text(text):
                    """Remove 'Observed X times' and similar patterns from recommendation text"""
                    if not text:
                        return ''
                    import re
                    original = text
                    # Remove patterns like "Observed 2 times", "Observed X times", etc.
                    text = re.sub(r'\s*Observed\s+\d+\s+times?\s*', '', text, flags=re.IGNORECASE)
                    text = re.sub(r'\s*Observed\s+\w+\s+times?\s*', '', text, flags=re.IGNORECASE)
                    # Remove trailing/leading whitespace
                    cleaned = text.strip()
                    if original != cleaned:
                        print(f"[REC DEBUG] Cleaned text: '{original[:60]}...' -> '{cleaned[:60]}...'")
                    return cleaned

                # Step 1: Sort all recommendations by count (descending) to identify most critical
                sorted_recs = sorted(recommendations, key=lambda x: int(x.get('count', 0)), reverse=True)
                print(f"[REC DEBUG] Top 5 sorted by count: {[(r.get('count'), r.get('text', '')[:50]) for r in sorted_recs[:5]]}")

                # Step 2: Select top 10-12 most critical issues as candidates
                critical_candidates = sorted_recs[:12]

                # Step 3: Ensure top 4 (or at least 3, minimum 2) are definitely included
                must_include = sorted_recs[:4] if len(sorted_recs) >= 4 else sorted_recs[:max(2, len(sorted_recs))]

                # Step 4: Group critical issues by screen
                from collections import defaultdict, OrderedDict
                screen_to_critical_issues = defaultdict(list)

                for rec in critical_candidates:
                    img_src = rec.get('image', '')
                    if img_src:
                        screen_to_critical_issues[img_src].append(rec)

                # Step 5: Select 3 screens using greedy algorithm to cover most critical issues
                selected_screens_data = []
                covered_issue_ids = set()

                print(f"[DEBUG] Total unique screens with critical issues: {len(screen_to_critical_issues)}")
                print(f"[DEBUG] Must include count: {len(must_include)}")

                # Greedy selection: pick screens that cover the most uncovered critical issues
                while len(selected_screens_data) < 3 and len(screen_to_critical_issues) > 0:
                    best_screen = None
                    best_score = 0
                    best_img_src = None

                    for img_src, screen_issues in screen_to_critical_issues.items():
                        if img_src in [s['img_src'] for s in selected_screens_data]:
                            continue

                        # Count uncovered issues on this screen
                        uncovered_issues = [r for r in screen_issues if id(r) not in covered_issue_ids]

                        # Check if this screen has must-include issues
                        has_must_include = any(id(r) in [id(m) for m in must_include] for r in uncovered_issues)

                        # Score: number of uncovered issues + bonus for must-include
                        score = len(uncovered_issues)
                        if has_must_include:
                            score += 100  # Heavy priority for must-include issues

                        if score > best_score:
                            best_score = score
                            best_screen = uncovered_issues
                            best_img_src = img_src

                    if best_screen and best_img_src:
                        selected_screens_data.append({
                            'img_src': best_img_src,
                            'issues': best_screen
                        })
                        # Mark issues as covered
                        for r in best_screen:
                            covered_issue_ids.add(id(r))
                        print(f"[DEBUG] Selected screen {len(selected_screens_data)}: {best_img_src[:50]}, issues: {len(best_screen)}")
                    else:
                        break

                print(f"[REC DEBUG] ✓ Final selected screens: {len(selected_screens_data)}")

                # Step 6: Display each screen once with its 2-3 most critical issues
                total_issues_displayed = 0

                for screen_idx, screen_data in enumerate(selected_screens_data, start=1):
                    print(f"[REC DEBUG] Processing screen {screen_idx}/{len(selected_screens_data)}")
                    if total_issues_displayed >= 8:
                        break

                    img_src = screen_data['img_src']
                    screen_issues = screen_data['issues']

                    # Sort issues by criticality and take top 2-3
                    screen_issues_sorted = sorted(screen_issues, key=lambda x: int(x.get('count', 0)), reverse=True)
                    remaining_slots = min(3, 8 - total_issues_displayed)
                    issues_to_display = screen_issues_sorted[:remaining_slots]

                    if not issues_to_display:
                        print(f"[REC DEBUG] Skipping screen {screen_idx} - no issues to display")
                        continue

                    print(f"[REC DEBUG] ✓ Displaying screen {screen_idx} with {len(issues_to_display)} issues")

                    # Fetch and display screen image (only once per screen)
                    img_buf = fetch_img(img_src)
                    if img_buf:
                        try:
                            img_buf.seek(0)
                            img_el = RLImage(img_buf, width=90 * mm, height=60 * mm)
                        except:
                            img_el = Paragraph('No image', styles['Normal'])
                    else:
                        img_el = Paragraph('No image', styles['Normal'])

                    # Build list of recommendations for this screen (no observation count)
                    issues_text = f"<b>Screen {screen_idx}:</b><br/><br/>"
                    for issue_idx, rec in enumerate(issues_to_display, start=1):
                        raw_text = rec.get('text', rec.get('text_raw', 'No recommendation'))
                        cleaned_text = clean_rec_text(raw_text)
                        sanitized_text = sanitize_text(cleaned_text)
                        print(f"[REC DEBUG]   Issue {issue_idx}: '{sanitized_text[:60]}...'")
                        issues_text += f"{issue_idx}. {sanitized_text}<br/><br/>"
                        total_issues_displayed += 1

                    text_el = Paragraph(issues_text, styles['ReportBody'])

                    # Create table with image on left, recommendations on right
                    row = Table([[img_el, text_el]], colWidths=[95 * mm, 83 * mm])
                    row.setStyle(TableStyle([
                        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
                        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fffbeb')),
                        ('LEFTPADDING', (0, 0), (-1, -1), 8),
                        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                        ('TOPPADDING', (0, 0), (-1, -1), 8),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                    ]))
                    story.append(row)
                    story.append(Spacer(1, 12))

                print(f"[REC DEBUG] ✓ Total issues displayed: {total_issues_displayed}")
                print(f"{'='*80}\n")
    except Exception as e:
        print(f"Error adding Recommendations section: {e}")
        import traceback
        traceback.print_exc()
        pass

    # 3. Sentiment Drift Section - Charts for each persona with per-user lines
    try:
        if section in ('full',) and persona:
            # Get sentiment series data
            sentiment_series = persona.get('sentiment_series') or []
            if sentiment_series:
                story.append(PageBreak())
                story.append(Paragraph('<b>Sentiment Drift</b>', styles['Heading2']))
                story.append(Spacer(1, 8))

                # Create line chart with one line per user
                fig, ax = plt.subplots(figsize=(7, 4))

                for idx, user_series in enumerate(sentiment_series):
                    user_name = user_series.get('name', f'User {idx+1}')
                    points = user_series.get('points', [])
                    if points:
                        steps = [p.get('step', 0) for p in points]
                        sentiments = [p.get('sentiment', 0) for p in points]
                        color = getUserColor(idx, len(sentiment_series))
                        ax.plot(steps, sentiments, marker='o', label=user_name, color=color, linewidth=2, markersize=4)

                ax.set_title('Sentiment Drift by User', fontsize=14, fontweight='bold', color='#1f2937', pad=20)
                ax.set_xlabel('Step', fontsize=11, color='#374151')
                ax.set_ylabel('Sentiment', fontsize=11, color='#374151')
                ax.legend(loc='best', fontsize=9)
                ax.grid(True, alpha=0.3, color='#e5e7eb')

                fig.patch.set_facecolor('white')
                ax.set_facecolor('white')

                img_buf = io.BytesIO()
                plt.tight_layout()
                fig.savefig(img_buf, format='png', dpi=300, facecolor='white', edgecolor='none', bbox_inches='tight')
                plt.close(fig)
                img_buf.seek(0)
                story.append(RLImage(img_buf, width=170 * mm, height=100 * mm))
                story.append(Spacer(1, 10))
    except Exception as e:
        print(f"Error adding Sentiment Drift section: {e}")
        pass

    # 4. Flow Insights Section - Charts for each persona with per-user data
    try:
        if section in ('full',) and persona:
            # Get paths data
            paths = persona.get('paths') or []
            if paths:
                story.append(PageBreak())
                story.append(Paragraph('<b>Flow Insights</b>', styles['Heading2']))
                story.append(Spacer(1, 8))

                # Create bar chart of top paths
                path_names = [sanitize_text(p.get('path', f'Path {i+1}'))[:40] for i, p in enumerate(paths[:6])]
                path_shares = [p.get('sharePct', 0) for p in paths[:6]]

                if path_names:
                    fig, ax = plt.subplots(figsize=(7, 4))

                    bars = ax.barh(range(len(path_names)), path_shares, color='#3b82f6', alpha=0.8)
                    ax.set_yticks(range(len(path_names)))
                    ax.set_yticklabels([textwrap.fill(name, width=30) for name in path_names])
                    ax.set_xlabel('Share (%)', fontsize=11, color='#374151')
                    ax.set_title('Top User Flows', fontsize=14, fontweight='bold', color='#1f2937', pad=20)

                    # Add value labels
                    for i, (bar, val) in enumerate(zip(bars, path_shares)):
                        ax.text(bar.get_width() + 1, bar.get_y() + bar.get_height()/2,
                               f'{val:.1f}%', va='center', fontsize=9, color='#374151')

                    fig.patch.set_facecolor('white')
                    ax.set_facecolor('white')
                    ax.grid(True, alpha=0.3, color='#e5e7eb', axis='x')

                    img_buf = io.BytesIO()
                    plt.tight_layout()
                    fig.savefig(img_buf, format='png', dpi=300, facecolor='white', edgecolor='none', bbox_inches='tight')
                    plt.close(fig)
                    img_buf.seek(0)
                    story.append(RLImage(img_buf, width=170 * mm, height=100 * mm))
                    story.append(Spacer(1, 10))
    except Exception as e:
        print(f"Error adding Flow Insights section: {e}")
        pass

    # Build document (with safe fallback in case any flowable fails)
    try:
        doc.build(story)
        pdf_bytes = pdf_io.getvalue()
        # Debug: write a copy to logs for inspection
        try:
            _root = pathlib.Path(__file__).resolve().parent.parent
            _log_dir = _root / 'logs'
            _log_dir.mkdir(parents=True, exist_ok=True)
            (_log_dir / f'UX_Report_{run_id}.pdf').write_bytes(pdf_bytes)
            # Write a small debug text with header/trailer bytes and length
            head = pdf_bytes[:8]
            tail = pdf_bytes[-8:]
            dbg = f"len={len(pdf_bytes)}\nhead={head!r}\ntail={tail!r}\n"
            (_log_dir / f'UX_Report_{run_id}.pdf.txt').write_text(dbg, encoding='utf-8')
        except Exception:
            pass
        pdf_io.close()
        return pdf_bytes
    except Exception:
        try:
            pdf_io.close()
        except Exception:
            pass
        # Fallback minimal PDF so the file always opens
        fb = io.BytesIO()
        fb_doc = SimpleDocTemplate(
            fb,
            pagesize=A4,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            topMargin=16 * mm,
            bottomMargin=16 * mm,
        )
        try:
            fb_story = [Paragraph('Report generation failed. Please retry. If the problem persists, check server logs.', getSampleStyleSheet()['BodyText'])]
        except Exception:
            fb_story = []
        try:
            fb_doc.build(fb_story)
        except Exception:
            pass
        pdf_bytes = fb.getvalue()
        try:
            _root = pathlib.Path(__file__).resolve().parent.parent
            _log_dir = _root / 'logs'
            _log_dir.mkdir(parents=True, exist_ok=True)
            (_log_dir / f'UX_Report_{run_id}.pdf').write_bytes(pdf_bytes)
            head = pdf_bytes[:8]; tail = pdf_bytes[-8:]
            dbg = f"len={len(pdf_bytes)}\nhead={head!r}\ntail={tail!r}\n"
            (_log_dir / f'UX_Report_{run_id}.pdf.txt').write_text(dbg, encoding='utf-8')
        except Exception:
            pass
        fb.close()
        return pdf_bytes
