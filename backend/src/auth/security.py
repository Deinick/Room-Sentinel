"""Password hashing and the shared OAuth2 scheme."""

from fastapi.security import HTTPBearer
from pwdlib import PasswordHash

# Reads "Authorization: Bearer <token>". Tokens are issued by POST /token.
bearer_scheme = HTTPBearer()

_password_hash = PasswordHash.recommended()


def verify_password(plain: str, hashed: str) -> bool:
    return _password_hash.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    return _password_hash.hash(password)
