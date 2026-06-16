import os
import time
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

async def wait_for_mongodb():
    mongo_url = os.environ.get('MONGO_URL', 'mongodb://mongodb:27017')
    print(f'Waiting for MongoDB at {mongo_url}...')
    max_attempts = 30
    attempt = 0
    while attempt < max_attempts:
        try:
            client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
            await client.admin.command('ping')
            print('MongoDB is ready!')
            client.close()
            return
        except Exception as e:
            attempt += 1
            print(f'Attempt {attempt}/{max_attempts} failed: {e}')
            time.sleep(2)
    print('Failed to connect to MongoDB after multiple attempts')
    exit(1)

if __name__ == '__main__':
    asyncio.run(wait_for_mongodb())
