import traceback
import re
from datetime import datetime, timezone
from threading import Lock

from pydantic import BaseModel, Field, field_validator
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


from backend import run_trip_agent

# Rate limiting configuration
DAILY_LIMIT = 5

limiter = Limiter(
    key_func=get_remote_address,
    headers_enabled=True,
)

# In-memory daily usage tracking (single-process demo only)
daily_usage: dict[tuple[str, str], int] = {}
daily_usage_lock = Lock()


def reserve_daily_request(ip: str) -> bool:
    """Reserve one planning request for this IP and UTC day."""
    today = datetime.now(timezone.utc).date().isoformat()
    key = (ip, today)

    with daily_usage_lock:
        used = daily_usage.get(key, 0)

        if used >= DAILY_LIMIT:
            return False

        daily_usage[key] = used + 1

        # Remove expired entries occasionally to limit memory growth.
        if len(daily_usage) > 10_000:
            daily_usage_copy = {
                entry_key: count
                for entry_key, count in daily_usage.items()
                if entry_key[1] == today
            }
            daily_usage.clear()
            daily_usage.update(daily_usage_copy)

        return True


app = FastAPI(
    title="Multi-Agent Trip Planner",
    description="A multi-agent system for planning trips, including flight and hotel searches, itinerary generation, and final response formatting.",
    version="1.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded,
    _rate_limit_exceeded_handler,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# pydantic model
class TripRequest(BaseModel):
    message: str = Field(min_length=12, max_length=4000)
    thread_id: str | None = None

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        value = value.strip()
        words = value.split()

        if len(value) < 12 or len(words) < 3:
            raise ValueError("Please provide a detailed travel-planning request.")

        if not re.search(r"[a-zA-Z]{2,}", value):
            raise ValueError("Please enter a meaningful request.")

        if not re.search(
            r"\b(trip|travel|visit|vacation|holiday|itinerary|"
            r"destination|flight|flights|hotel|hotels|tour|explore|"
            r"sightseeing|adventure|beach|mountain|days?|nights?|"
            r"budget|departing|departure|from|to|stay|traveling|"
            r"travelling|backpacking|road trip)\b",
            value,
            re.IGNORECASE,
        ):
            raise ValueError("Please provide a travel-related request.")

        return value


# API endpoint for trip planning
@app.post("/api/plan_trip")
@limiter.limit("1/minute")
async def plan_trip(request: Request, request_data: TripRequest):
    client_ip = get_remote_address(request)
    user_message = request_data.message.strip()

    if not user_message:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "The 'message' field is required and cannot be empty.",
            },
        )

    # Enforce the daily quota before invoking the agents.
    if not reserve_daily_request(client_ip):
        return JSONResponse(
            status_code=429,
            content={
                "success": False,
                "error": (
                    f"Daily limit reached. You can plan up to "
                    f"{DAILY_LIMIT} trips per IP address each day. "
                    "Please try again tomorrow."
                ),
            },
        )

    try:
        result = run_trip_agent(
            user_input=user_message,
            thread_id=request_data.thread_id,
        )

        return JSONResponse(
            content={
                "success": True,
                "thread_id": result["thread_id"],
                "answer": result["answer"],
                "flight_results": result["flight_results"],
                "hotel_results": result["hotel_results"],
                "itinerary": result["itinerary"],
                "llm_calls": result["llm_calls"],
            }
        )

    except Exception:
        print("Error processing request:")
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "An error occurred while planning your trip.",
            },
        )


# API endpoint for health check
@app.get("/api/health")
async def health_check():
    return JSONResponse(
        content={
            "status": "healthy",
            "message": "The Multi-Agent Trip Planner API is running smoothly.",
        }
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
