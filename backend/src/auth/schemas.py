from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr


class _OrmBase(BaseModel):
    """Shared config: allows building schemas directly from ORM model instances."""
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class Token(_OrmBase):
    access_token: str
    token_type: str


# ---------------------------------------------------------------------------
# User - request bodies
# ---------------------------------------------------------------------------

class UserCreate(_OrmBase):
    """Registration payload. Single password field; strength is validated in the service."""
    username: str
    email: EmailStr
    password: str


class UpdateUser(_OrmBase):
    """Partial update payload. Only non-None fields are applied."""
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password1: Optional[str] = None
    password2: Optional[str] = None


# ---------------------------------------------------------------------------
# User - response bodies
# ---------------------------------------------------------------------------

class ReadUser(_OrmBase):
    """Public user representation returned to any authenticated caller."""
    id: int
    username: str
    email: str


class PrivateUser(_OrmBase):
    """
    Extended user view for staff/admin endpoints.
    NOTE: never include hashed_password in any response schema.
    """
    id: int
    username: str
    email: str
    is_active: bool
    is_superuser: bool
    is_staff: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None  # Nullable - only set after soft-delete.
