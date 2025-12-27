"""
游戏后端代理服务器
- 图片增强 (Gemini API)
- 地点搜索 (Places API)
- 3D Tiles 代理
- Static Maps 代理

用法：
1. pip install fastapi uvicorn httpx
2. uvicorn enhance_server:app --host 0.0.0.0 --port 8000

API Key 从 ../config.js 自动读取
"""

import os
import re
from typing import Optional
from pathlib import Path
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# CORS 配置 - 生产环境请限制 origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境改为你的域名 ["https://yourdomain.com"]
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def load_api_key():
    """从 config.js 读取 API Key"""
    # 先检查环境变量
    if os.environ.get("GOOGLE_API_KEY"):
        return os.environ.get("GOOGLE_API_KEY")

    # 从 config.js 读取
    config_path = Path(__file__).parent.parent / "config.js"
    if config_path.exists():
        content = config_path.read_text()
        match = re.search(r"GOOGLE_API_KEY:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            return match.group(1)

    return None


GOOGLE_API_KEY = load_api_key()

# Gemini API
GEMINI_MODEL = "gemini-3-pro-image-preview"
GEMINI_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

# Places API (New)
PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"

# Google 3D Tiles API
TILES_BASE_URL = "https://tile.googleapis.com"


class EnhanceRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/png"


@app.post("/api/enhance")
async def enhance_image(req: EnhanceRequest):
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured")

    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {
                    "inline_data": {
                        "mime_type": req.mime_type,
                        "data": req.image_base64
                    }
                },
                {
                    "text": "Transform this 3D game screenshot into a photorealistic street photograph. Keep the same composition, perspective, and scene elements, but make it look like a real photo taken with a camera. Add realistic lighting, textures, weather effects, and natural imperfections. Output only the enhanced image."
                }
            ]
        }],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"]
        }
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(
                GEMINI_ENDPOINT,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": GOOGLE_API_KEY
                },
                json=payload
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    data = resp.json()

    # 解析响应
    try:
        parts = data["candidates"][0]["content"]["parts"]
        for part in parts:
            if "inlineData" in part:
                return {
                    "image_base64": part["inlineData"]["data"],
                    "mime_type": part["inlineData"].get("mimeType", "image/jpeg")
                }
        raise HTTPException(status_code=500, detail="No image in response")
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {e}")


# ============ Places API ============

class AutocompleteRequest(BaseModel):
    input: str
    language: str = "zh-CN"


@app.post("/api/places/autocomplete")
async def places_autocomplete(req: AutocompleteRequest):
    """地点自动补全"""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured")

    payload = {
        "input": req.input,
        "languageCode": req.language
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                PLACES_AUTOCOMPLETE_URL,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_API_KEY
                },
                json=payload
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    data = resp.json()

    # 转换为简化格式
    suggestions = []
    for item in data.get("suggestions", []):
        place = item.get("placePrediction", {})
        if place:
            suggestions.append({
                "place_id": place.get("placeId"),
                "description": place.get("text", {}).get("text", ""),
                "main_text": place.get("structuredFormat", {}).get("mainText", {}).get("text", ""),
                "secondary_text": place.get("structuredFormat", {}).get("secondaryText", {}).get("text", "")
            })

    return {"suggestions": suggestions}


class PlaceDetailsRequest(BaseModel):
    place_id: str


@app.post("/api/places/details")
async def places_details(req: PlaceDetailsRequest):
    """获取地点详情（坐标）"""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured")

    url = f"{PLACES_DETAILS_URL}/{req.place_id}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                url,
                headers={
                    "X-Goog-Api-Key": GOOGLE_API_KEY,
                    "X-Goog-FieldMask": "id,displayName,location,formattedAddress"
                }
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    data = resp.json()

    location = data.get("location", {})
    return {
        "place_id": data.get("id"),
        "name": data.get("displayName", {}).get("text", ""),
        "address": data.get("formattedAddress", ""),
        "lat": location.get("latitude"),
        "lng": location.get("longitude")
    }


# ============ 3D Tiles 代理 ============

from fastapi import Request
from fastapi.responses import Response

@app.api_route("/api/tiles/{path:path}", methods=["GET", "POST"])
async def tiles_proxy(path: str, request: Request):
    """Google 3D Tiles 代理 - 隐藏 API Key"""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured")

    # 构建目标 URL
    target_url = f"{TILES_BASE_URL}/{path}"

    # 保留原始查询参数，添加 API key
    query_params = dict(request.query_params)
    query_params["key"] = GOOGLE_API_KEY

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            if request.method == "GET":
                resp = await client.get(target_url, params=query_params)
            else:
                body = await request.body()
                resp = await client.post(target_url, params=query_params, content=body)

            # 返回原始响应（包括二进制数据）
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers={
                    "Content-Type": resp.headers.get("Content-Type", "application/octet-stream"),
                    "Access-Control-Allow-Origin": "*"
                }
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


# ============ Static Maps 代理 ============

STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap"

@app.get("/api/staticmap")
async def static_map(
    lat: float,
    lng: float,
    zoom: int = 17,
    width: int = 300,
    height: int = 180,
    heading: float = 0
):
    """Google Static Maps 代理 - 返回地图图片"""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured")

    # 构建请求参数
    params = {
        "center": f"{lat},{lng}",
        "zoom": zoom,
        "size": f"{width}x{height}",
        "maptype": "roadmap",
        "language": "zh-CN",
        "key": GOOGLE_API_KEY
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(STATIC_MAPS_URL, params=params)
            resp.raise_for_status()
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                media_type="image/png",
                headers={"Access-Control-Allow-Origin": "*"}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}
