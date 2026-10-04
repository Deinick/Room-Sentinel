from alembic import context
from sqlalchemy import create_engine, pool

from src.database import Base, database_url

# Import model modules here so autogenerate sees their tables.
import src.auth.models  # noqa: F401
import src.device.models  # noqa: F401
import src.push.models  # noqa: F401
import src.sentinel.device_readings.models  # noqa: F401

url = database_url()
target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # metrics and issue_events are written with raw SQL and have no model;
    # without this, autogenerate would propose dropping them.
    return not (type_ == "table" and reflected and compare_to is None)

if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, include_object=include_object, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(url, poolclass=pool.NullPool).connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()
