'''
Author: 袁瑞 && 2502099390@qq.com
Date: 2026-06-12 09:45:05
LastEditors: 袁瑞 && 2502099390@qq.com
LastEditTime: 2026-06-12 09:55:08
FilePath: \sample_admin\backend\app\db\session.py
Description: 
'''
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 5},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
