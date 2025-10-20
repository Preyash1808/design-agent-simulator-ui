"""
Storage utilities for Supabase integration.
Handles file uploads, signed URL generation, and storage operations.
"""
import os
import pathlib
import traceback
import logging
from typing import Optional
from slugify import slugify
from supabase import create_client
import io
import zipfile

# Global Supabase client cache
_SUPABASE_CLIENT = None

# Initialize logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)
    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s")
    ch.setFormatter(formatter)
    logger.addHandler(ch)


def get_supabase():
    """Get or create Supabase client from environment variables."""
    global _SUPABASE_CLIENT
    if _SUPABASE_CLIENT is not None:
        return _SUPABASE_CLIENT
    # Support both backend-style and PUBLIC_* env names from .env
    url = os.getenv('SUPABASE_URL') or os.getenv('PUBLIC_SUPABASE_URL')
    key = (
        os.getenv('SUPABASE_SERVICE_ROLE')
        or os.getenv('SUPABASE_ANON_KEY')
        or os.getenv('SUPABASE_KEY')
        or os.getenv('PUBLIC_SUPABASE_ANON_KEY')
    )
    if not url or not key:
        return None
    try:
        _SUPABASE_CLIENT = create_client(url, key)
        return _SUPABASE_CLIENT
    except Exception:
        return None


def use_supabase_db() -> bool:
    """Determine whether to use Supabase client for auth endpoints.

    Enabled when:
    - USE_SUPABASE_DB is truthy (1/true/yes), and
    - Supabase client can be constructed from env (.env supported).

    Additionally, if USE_SUPABASE_DB is not set, auto-enable when SUPABASE
    creds are provided and no DATABASE_URL is configured.
    """
    flag_env = os.getenv('USE_SUPABASE_DB')
    if flag_env is not None:
        flag = flag_env.lower() in {'1', 'true', 'yes'}
        return bool(flag and get_supabase())
    # Auto-enable if Supabase is configured and direct DB URL is not
    if get_supabase() and not os.getenv('DATABASE_URL'):
        return True
    return False


def _detect_content_type(path: pathlib.Path) -> str:
    """Detect MIME content type from file extension."""
    ext = path.suffix.lower()
    if ext in {'.png'}:
        return 'image/png'
    if ext in {'.jpg', '.jpeg'}:
        return 'image/jpeg'
    if ext in {'.gif'}:
        return 'image/gif'
    if ext in {'.svg'}:
        return 'image/svg+xml'
    if ext in {'.webp'}:
        return 'image/webp'
    if ext in {'.csv'}:
        return 'text/csv'
    if ext in {'.log', '.txt'}:
        return 'text/plain'
    if ext in {'.pdf'}:
        return 'application/pdf'
    return 'application/octet-stream'


def upload_log_to_supabase(local_path: pathlib.Path, project_name: str, kind: str, run_id: Optional[str] = None) -> Optional[str]:
    """
    Uploads a log file to Supabase Storage and returns a signed or public URL.
    Includes detailed logs for success and failure at each step.
    """
    logger.info(f"Starting upload_log_to_supabase for project='{project_name}', kind='{kind}', run_id='{run_id}'")
    logger.debug(f"Local path: {local_path}")

    try:
        client = get_supabase()
        if not client:
            logger.error("Supabase client not initialized (get_supabase() returned None).")
            return None

        if not local_path.exists():
            logger.error(f"Local file does not exist: {local_path}")
            return None

        bucket = os.getenv('SUPABASE_BUCKET', 'logs')
        proj = slugify(project_name)
        if kind == 'preprocess':
            storage_path = f"{proj}/preprocess/{local_path.name}"
        else:
            storage_path = f"{proj}/runs/{run_id or 'unknown'}/{local_path.name}"
        logger.debug(f"Determined Supabase storage path: {storage_path} (bucket: {bucket})")

        # Read local file
        try:
            data = local_path.read_bytes()
            logger.info(f"Successfully read {len(data)} bytes from local file: {local_path}")
        except Exception as e:
            logger.exception(f"Failed to read local file: {local_path}. Error: {e}")
            return None

        # Upload to Supabase
        try:
            logger.debug("Uploading to Supabase...")
            response = client.storage.from_(bucket).upload(
                storage_path, data, {'content-type': 'text/plain', 'x-upsert': 'true'}
            )
            logger.info(f"Upload response: {response}")
        except Exception as e:
            logger.exception(f"Failed to upload to Supabase (bucket={bucket}, path={storage_path}). Error: {e}")
            return None

        # Create signed URL
        try:
            expires = int(os.getenv('SUPABASE_SIGNED_URL_SECONDS', '86400'))
            logger.debug(f"Attempting to create signed URL (expires in {expires} seconds)")
            signed = client.storage.from_(bucket).create_signed_url(storage_path, expires)
            logger.debug(f"Signed URL response: {signed}")

            url = None
            if isinstance(signed, dict):
                url = (
                    signed.get('signed_url')
                    or signed.get('signedURL')
                    or (signed.get('data') or {}).get('signedUrl')
                    or (signed.get('data') or {}).get('signedURL')
                )

            if not url:
                logger.warning("Signed URL not available, falling back to public URL.")
                url = client.storage.from_(bucket).get_public_url(storage_path)

            if url:
                logger.info(f"File successfully uploaded. Accessible at: {url}")
            else:
                logger.error("Failed to retrieve signed or public URL after upload.")

            return url
        except Exception as e:
            logger.exception(f"Failed to create or fetch signed/public URL for uploaded file. Error: {e}")
            return None

    except Exception as e:
        logger.error(f"Unexpected exception in upload_log_to_supabase: {e}")
        logger.debug(traceback.format_exc())
        return None


def upload_file_to_supabase(local_path: pathlib.Path, storage_path: str, bucket: Optional[str] = None) -> Optional[str]:
    """Generic file upload to Supabase storage with signed URL generation."""
    client = get_supabase()
    if not client or not local_path.exists():
        return None
    bucket_name = bucket or os.getenv('SUPABASE_ASSETS_BUCKET', os.getenv('SUPABASE_BUCKET', 'artifacts'))
    try:
        data = local_path.read_bytes()
        content_type = _detect_content_type(local_path)
        client.storage.from_(bucket_name).upload(storage_path, data, {'content-type': content_type, 'upsert': True})
        expires = int(os.getenv('SUPABASE_SIGNED_URL_SECONDS', '86400'))
        signed = client.storage.from_(bucket_name).create_signed_url(storage_path, expires)
        url = None
        if isinstance(signed, dict):
            url = (
                signed.get('signed_url') or signed.get('signedURL') or
                (signed.get('data') or {}).get('signedUrl') or (signed.get('data') or {}).get('signedURL')
            )
        if not url:
            try:
                url = client.storage.from_(bucket_name).get_public_url(storage_path)
            except Exception:
                url = None
        return url
    except Exception:
        return None


def upload_run_artifacts(run_dir: pathlib.Path, project_name: str, run_id: str) -> None:
    """Upload all files in a run directory to Supabase storage."""
    client = get_supabase()
    if not client:
        return
    proj = slugify(project_name)
    for path in run_dir.rglob('*'):
        try:
            if not path.is_file():
                continue
            try:
                rel = path.relative_to(run_dir).as_posix()
            except Exception:
                rel = path.name
            storage_path = f"{proj}/runs/{run_id}/{rel}"
            upload_file_to_supabase(path, storage_path)
        except Exception:
            pass


def upload_tests_dir_zip(run_dir: pathlib.Path, project_name: str, run_id: str, zip_name: str = 'tests.zip') -> Optional[str]:
    """Zip the tests/ folder under a run directory and upload as a single object.

    Returns a signed (or public) URL to the uploaded zip, or None on failure.
    """
    client = get_supabase()
    if not client:
        return None
    tests_dir = run_dir / 'tests'
    if not tests_dir.exists():
        return None
    # Build zip in-memory
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for path in tests_dir.rglob('*'):
                if not path.is_file():
                    continue
                try:
                    arc = path.relative_to(run_dir).as_posix()  # include 'tests/...'
                except Exception:
                    arc = f"tests/{path.name}"
                zf.write(path, arc)
        data = buf.getvalue()
    except Exception:
        return None

    proj = slugify(project_name)
    storage_path = f"{proj}/runs/{run_id}/{zip_name}"
    bucket = os.getenv('SUPABASE_ASSETS_BUCKET', os.getenv('SUPABASE_BUCKET', 'artifacts'))
    try:
        client.storage.from_(bucket).upload(storage_path, data, {'content-type': 'application/zip', 'upsert': True})
        expires = int(os.getenv('SUPABASE_SIGNED_URL_SECONDS', '86400'))
        signed = client.storage.from_(bucket).create_signed_url(storage_path, expires)
        url = None
        if isinstance(signed, dict):
            url = (
                signed.get('signed_url') or signed.get('signedURL') or
                (signed.get('data') or {}).get('signedUrl') or (signed.get('data') or {}).get('signedURL')
            )
        if not url:
            try:
                url = client.storage.from_(bucket).get_public_url(storage_path)
            except Exception:
                url = None
        return url
    except Exception:
        return None

