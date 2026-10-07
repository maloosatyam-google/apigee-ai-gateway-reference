# ADK Dual-Pattern Integration Recipes

## Recipe 1: Connecting Python ADK to Apigee AI Gateway
```python
import httpx

async def call_vertex_via_apigee(prompt: str, model: str = "gemini-1.5-flash"):
    url = f"https://my-apigee-org-eval.apigee.net/ai/v1/models/{model}:generateContent"
    headers = {
        "x-apikey": "my-enterprise-key",
        "x-target-model": model,
        "Content-Type": "application/json"
    }
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}]
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, json=payload)
        return response.json()
```

## Recipe 2: Invoking Tools via Apigee Tools Gateway
```python
async def call_tool_via_apigee(tool_name: str, args: dict):
    url = f"https://my-apigee-org-eval.apigee.net/tools/v1/tools/{tool_name}/execute"
    headers = {
        "x-apikey": "my-enterprise-key",
        "Content-Type": "application/json"
    }
    payload = {"arguments": args}
    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, json=payload)
        return response.json()
```
