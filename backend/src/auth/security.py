"""Password hashing and the shared OAuth2 scheme."""

from fastapi.security import OAuth2PasswordBearer
from pwdlib import PasswordHash

# tokenUrl must match the POST /token route defined in routes.py.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

_password_hash = PasswordHash.recommended()


def verify_password(plain: str, hashed: str) -> bool:
    return _password_hash.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    return _password_hash.hash(password)
