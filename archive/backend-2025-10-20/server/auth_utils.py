from datetime import datetime, timedelta
import os
from typing import Optional
from passlib.context import CryptContext
from jose import jwt, JWTError
from dotenv import load_dotenv

load_dotenv()

# password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)

# JWT config
SECRET_KEY = os.getenv("JWT_SECRET", "supersecret")  # set JWT_SECRET in .env for production
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # If "sub" is missing, just return the full payload
        return payload.get("sub") or payload
    except JWTError as e:
        print(f"Token decode failed: {e}")
        return None


def get_current_user(authorization: Optional[str] = None):
    """Extract current user email (subject) from Authorization: Bearer token.
    Returns None if header is missing/invalid or token can't be decoded.
    """
    if not authorization or not isinstance(authorization, str):
        return None
    lower = authorization.lower()
    if not lower.startswith('bearer '):
        return None
    try:
        token = authorization.split(' ', 1)[1]
    except Exception:
        return None
    return decode_access_token(token)
