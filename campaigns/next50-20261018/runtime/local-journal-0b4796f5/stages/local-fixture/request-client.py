import urllib.request
r=urllib.request.Request('http://qwen.endoforge.invalid/v1/chat/completions',data=b'{"model": "qwen-local", "messages": [{"role": "user", "content": "deterministic fixture request"}], "temperature": 0, "stream": false, "max_tokens": 8}',headers={"Content-Type":"application/json"})
with urllib.request.urlopen(r,timeout=180) as response:print(response.read().decode())
