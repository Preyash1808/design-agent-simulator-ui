from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
import io

from .report_builder import build_report_pdf
from .metrics import get_run_metrics_public
from .routes.runs import persona_detail  # reuse existing persona endpoint logic
from fastapi import Request


router = APIRouter()


@router.get('/runs/{run_id}/report.pdf')
async def report_pdf(run_id: str, request: Request) -> Response:
    try:
        data: Dict[str, Any] = await get_run_metrics_public(run_id)
    except Exception:
        raise HTTPException(status_code=404, detail='run not found')
    # Optional query params: section=[overview|persona|full], personaId=...
    section = (request.query_params.get('section') or 'overview').lower()
    persona_id = request.query_params.get('personaId') or None
    persona_payload = None
    if section in ('persona', 'full') and persona_id:
        try:
            # Call the existing handler to compute persona metrics
            res = await persona_detail(run_id, persona_id)  # type: ignore
            # FastAPI handler returns dict directly; ensure plain dict
            persona_payload = res
        except Exception:
            persona_payload = None
    pdf_bytes = build_report_pdf(data, run_id, section=section, persona=persona_payload, persona_id=persona_id)
    return Response(
        content=pdf_bytes,
        media_type='application/pdf',
        headers={
            'Content-Disposition': f'attachment; filename="report_{run_id}.pdf"',
            'Content-Length': str(len(pdf_bytes)),
            'Cache-Control': 'no-store',
        },
    )


# Unified download endpoint per proposal
@router.get('/download-report')
async def download_report(
    run_id: str,
    report_type: str = Query(..., description='overview | persona | full | personas_excel'),
    personaId: str | None = Query(None),
):
    try:
        data: Dict[str, Any] = await get_run_metrics_public(run_id)
    except Exception:
        raise HTTPException(status_code=404, detail='run not found')

    persona_payload = None
    if report_type in ('persona', 'full') and personaId:
        try:
            res = await persona_detail(run_id, personaId)  # type: ignore
            persona_payload = res
        except Exception:
            persona_payload = None

    if report_type in ('overview', 'persona', 'full'):
        pdf_bytes = build_report_pdf(data, run_id, section=('overview' if report_type=='overview' else ('persona' if report_type=='persona' else 'full')), persona=persona_payload, persona_id=personaId)
        filename = f"UX_{report_type.capitalize()}_Report_{run_id}.pdf"
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename={filename}'})

    if report_type == 'personas_excel':
        # Reuse existing multi-persona Excel export if available
        from .routes.runs import all_personas_users_excel  # type: ignore
        return await all_personas_users_excel(run_id)  # type: ignore

    raise HTTPException(status_code=400, detail='invalid report_type')




