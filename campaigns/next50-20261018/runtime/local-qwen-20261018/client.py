import json,urllib.request
payload={"model":"qwen-local","messages":[{"role":"user","content":"Return only the integer 7."}],"max_tokens":64,"temperature":0,"stream":False}
r=urllib.request.Request("http://qwen.endoforge.invalid/v1/chat/completions",data=json.dumps(payload).encode(),headers={"Content-Type":"application/json"})
with urllib.request.urlopen(r,timeout=65) as response:print(response.read().decode())
