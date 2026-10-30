#!/usr/bin/env python3
"""Worker-local bounded loopback→Unix stream relay; no threads or forks."""
import asyncio
from pathlib import Path
active=0
async def relay(reader,writer):
 while chunk:=await reader.read(65536):
  writer.write(chunk);await writer.drain()
async def client(reader,writer):
 global active
 if active>=32:writer.close();return
 active+=1;remote=None;tasks=[]
 try:
  source,remote=await asyncio.open_unix_connection('/proxy.sock',limit=65536)
  tasks=[asyncio.create_task(relay(reader,remote)),asyncio.create_task(relay(source,writer))]
  _,pending=await asyncio.wait(tasks,timeout=185,return_when=asyncio.FIRST_COMPLETED)
  for task in pending:task.cancel()
 except (OSError,asyncio.TimeoutError):pass
 finally:
  for task in tasks:
   if not task.done():task.cancel()
  if tasks:await asyncio.gather(*tasks,return_exceptions=True)
  for stream in [writer,remote]:
   if stream:
    stream.close()
    try:await stream.wait_closed()
    except OSError:pass
  active-=1
async def main():
 server=await asyncio.start_server(client,'localhost',18080,limit=65536,backlog=32)
 Path('/tmp/bridge-ready').touch()
 async with server:await server.serve_forever()
if __name__=='__main__':asyncio.run(main())
