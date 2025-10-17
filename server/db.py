import os
import asyncio
from typing import Optional
import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')

_pool: Optional[asyncpg.Pool] = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError('DATABASE_URL not set')
        _pool = await asyncpg.create_pool(DATABASE_URL)
    return _pool

async def fetchrow(query: str, *args):
    pool = await get_pool()
    async with pool.acquire() as con:
        return await con.fetchrow(query, *args)

async def fetch(query: str, *args):
    pool = await get_pool()
    async with pool.acquire() as con:
        return await con.fetch(query, *args)

async def execute(query: str, *args):
    pool = await get_pool()
    async with pool.acquire() as con:
        return await con.execute(query, *args)

async def close_pool():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None

