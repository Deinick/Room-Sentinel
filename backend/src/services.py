"""
Base class for all service/repository classes.
Subclasses are instantiated automatically via get_repository() in database.py.
"""
 
import logging
 
from sqlalchemy.ext.asyncio import AsyncSession
 
logger = logging.getLogger(__name__)
 
 
class BaseService:
    """
    Provides a consistent constructor and thin session helpers for subclasses.
 
    In most cases the get_session() dependency commits/rolls back automatically,
    so subclasses should only call commit() when they need an intermediate flush
    (e.g. to obtain a DB-generated ID mid-request).
 
    Example subclass:
        class UserService(BaseService):
            async def get_by_email(self, email: str) -> User | None:
                result = await self.session.execute(select(User).where(User.email == email))
                return result.scalar_one_or_none()
    """
 
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
 
    async def commit(self) -> None:
        logger.debug("%s.commit()", self.__class__.__name__)
        await self.session.commit()
 
    async def rollback(self) -> None:
        logger.debug("%s.rollback()", self.__class__.__name__)
        await self.session.rollback()
 
    async def refresh(self, instance: object) -> None:
        """Reload instance from DB — useful after commit to get server-generated values."""
        logger.debug("%s.refresh(%r)", self.__class__.__name__, instance)
        await self.session.refresh(instance)