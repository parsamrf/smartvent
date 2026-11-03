"""POST /assistant  {question: str}   (AI Device Assistant, extra credit)

Read-only Q&A over the caller's own devices:
  1. Load the caller's registered nodes, their latest status, and a summary of
     the last hour of history from DynamoDB.
  2. Send that data (as JSON) plus the question to an open-source LLM behind an
     OpenAI-compatible chat API (Groq's free tier by default) with instructions
     to answer only from the supplied data and to say so when it can't.
  3. Return the answer and the snapshot it was based on.

The assistant has no tools and never publishes commands, so it cannot change
device state; control stays behind the authenticated command endpoints. The
API key lives in SSM Parameter Store and is only ever read by this Lambda.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

import boto3

from common import ApiError, _json_default, api_handler, body_json, response, user_id
from devices import list_devices
from history import query_history

MODEL = os.environ["ASSISTANT_MODEL"]
BASE_URL = os.environ["ASSISTANT_BASE_URL"].rstrip("/")
HISTORY_MINUTES = 60

SYSTEM_PROMPT = """You are the SmartVent assistant, embedded in a web dashboard for an IoT \
ventilation system. Each sensor node measures temperature (degC) and relative humidity (%), and \
drives a fan. (A reading that is missing from the data was not reported; never assume a value for \
it.) In "auto" mode a node turns its fan on when temperature reaches `settings.tempOn` or humidity \
reaches `settings.humOn`; in "manual" mode the user controls the fan directly.

The user's message contains a JSON snapshot of their devices retrieved from the database just \
now, followed by their question. Answer only from that snapshot:
- Refer to each device by its "name" (for example Bedroom or Kitchen) and never mention its \
deviceId unless the user asks for it. Cite the specific readings, \
modes, and fan states you used. Times in the snapshot are given as "secondsAgo"; say them in \
plain words such as "12 seconds ago" or "3 minutes ago".
- A device whose latest reading is more than 60 seconds old may be offline; say so when relevant.
- If the snapshot does not contain the information needed, say plainly that the available data \
doesn't support an answer, and say what data would be needed. Do not guess or invent values.
- You are read-only. If asked to change a setting or turn a fan on/off, explain that you can't \
make changes and that they can use the controls on the Dashboard page.
Rules you must never break: use only numbers that appear in the snapshot; never convert, \
estimate or invent a value; if a number is not in the snapshot, say you don't have it.
When comparing numbers, compare them carefully before you write, and write only your final \
answer: never correct yourself or write "wait" or "correction".
Keep answers short: a few sentences or a brief list. Plain text only: no markdown, no asterisks, \
no backticks, no headings. Write device names as plain text."""

_api_key = None


def api_key():
    """LLM API key from SSM Parameter Store (cached across warm invocations)."""
    global _api_key
    if _api_key is None:
        _api_key = boto3.client("ssm").get_parameter(
            Name=os.environ["ASSISTANT_KEY_PARAM"], WithDecryption=True
        )["Parameter"]["Value"]
    return _api_key


def chat(user_content):
    """One chat-completions call; returns (answer text, model name)."""
    body = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0,
        "max_tokens": 500,
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions", data=body, method="POST",
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            # Groq sits behind Cloudflare, which rejects urllib's default agent.
            "User-Agent": "smartvent-assistant/1.0",
        },
    )
    try:
        r = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as e:
        if e.code != 429:
            raise
        # Free-tier rate limit: wait briefly (as the API asks) and retry once.
        time.sleep(min(float(e.headers.get("retry-after") or 4), 6))
        r = urllib.request.urlopen(req, timeout=15)
    with r:
        data = json.loads(r.read())
    text = data["choices"][0]["message"].get("content") or ""
    # Some open models emit their reasoning in <think> tags; drop it.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    # The page shows plain text, so strip any markdown emphasis the model adds.
    text = re.sub(r"\*\*|__|`", "", text)
    text = re.sub(r"^\s*[*\-]\s+", "- ", text, flags=re.M).strip()
    return text, data.get("model", MODEL)


def ago(ts, now):
    """Seconds between an epoch-ms timestamp and `now` (epoch ms)."""
    return max(0, round((now - int(ts)) / 1000))


def summarize(items, now):
    """Compact stats over a window of history so the prompt stays small.
    Times are given as 'seconds ago' so the model never has to read epoch numbers."""
    if not items:
        return {"count": 0}

    def stats(field):
        vals = [float(i[field]) for i in items if field in i]
        if not vals:
            return None
        return {"min": min(vals), "max": max(vals), "avg": round(sum(vals) / len(vals), 2)}

    return {
        "count": len(items),
        "oldestReadingSecondsAgo": ago(items[0]["ts"], now),
        "newestReadingSecondsAgo": ago(items[-1]["ts"], now),
        "temperature": stats("temperature"),
        "humidity": stats("humidity"),
        "fanOnFraction": round(sum(1 for i in items if i.get("fanOn")) / len(items), 2),
        "recoveredBackfillReadings": sum(1 for i in items if i.get("source") == "backfill"),
        "recentReadings": [
            {"secondsAgo": ago(i["ts"], now),
             **{k: i[k] for k in ("temperature", "humidity", "mode", "fanOn", "source") if k in i}}
            for i in items[-5:]
        ],
    }


def build_snapshot(uid):
    now = int(time.time() * 1000)
    devices = []
    for d in list_devices(uid):
        latest = d["latest"] or {}
        for k in ("expiresAt", "receivedAt", "gateway", "seq", "source"):
            latest.pop(k, None)
        if "ts" in latest:
            latest["secondsAgo"] = ago(latest.pop("ts"), now)
        devices.append({
            "name": d["name"],
            "deviceId": d["deviceId"],
            "latest": latest or None,
            f"last{HISTORY_MINUTES}Minutes": summarize(query_history(d["deviceId"], HISTORY_MINUTES), now),
        })
    return {"devices": devices}


@api_handler
def handler(event, context):
    uid = user_id(event)
    question = str(body_json(event).get("question", "")).strip()
    if not question:
        raise ApiError(400, "question is required")
    if len(question) > 1000:
        raise ApiError(400, "question is too long (max 1000 characters)")

    snapshot = build_snapshot(uid)
    user_content = (
        "<device_data>\n" + json.dumps(snapshot, default=_json_default, separators=(",", ":")) + "\n</device_data>\n\n"
        f"Question: {question}"
    )

    try:
        answer, model = chat(user_content)
    except urllib.error.HTTPError as e:
        print(f"LLM API error {e.code}: {e.read()[:300]!r}")
        if e.code == 429:
            raise ApiError(429, "The assistant is busy; try again in a moment")
        raise ApiError(502, "The assistant is unavailable right now")
    except (urllib.error.URLError, TimeoutError):
        raise ApiError(504, "Could not reach the assistant service")

    if not answer:
        answer = "Sorry, I couldn't produce an answer. Please try rephrasing the question."

    return response(200, {"answer": answer, "model": model, "snapshot": snapshot})
