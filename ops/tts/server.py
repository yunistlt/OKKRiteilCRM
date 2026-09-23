"""TTS-сервер: синтез русской речи моделью Silero.

Контракт по образцу STT-сервера (см. lib/transcribe.ts):
    POST /tts   {"text": "...", "speaker": "kseniya", "format": "ogg"}
                -> audio/ogg (или audio/wav при format=wav)
    GET  /health -> {"status": "ok", "model": "v4_ru", "speakers": [...]}

Запуск:
    pip install torch fastapi uvicorn
    apt-get install -y ffmpeg          # нужен для ogg/opus (голосовые Telegram)
    uvicorn server:app --host 0.0.0.0 --port 8081
"""

import io
import os
import subprocess
import wave

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

SAMPLE_RATE = 48000
SPEAKERS = ["aidar", "baya", "kseniya", "xenia", "eugene"]
DEFAULT_SPEAKER = os.getenv("TTS_SPEAKER", "kseniya")
# Максимум символов за один запрос: Silero режет очень длинные строки,
# длинные отчёты дробим на предложения и склеиваем.
CHUNK_LIMIT = 900

torch.set_num_threads(int(os.getenv("TTS_THREADS", "4")))

app = FastAPI(title="OKK TTS")
_model = None


def get_model():
    global _model
    if _model is None:
        _model, _ = torch.hub.load(
            repo_or_dir="snakers4/silero-models",
            model="silero_tts",
            language="ru",
            speaker="v4_ru",
            trust_repo=True,
        )
        _model.to(torch.device("cpu"))
    return _model


def split_text(text: str) -> list[str]:
    """Дробит текст на куски не длиннее CHUNK_LIMIT по границам предложений."""
    parts, buf = [], ""
    for sentence in text.replace("\n", " ").split(". "):
        sentence = sentence.strip()
        if not sentence:
            continue
        candidate = f"{buf} {sentence}." if buf else f"{sentence}."
        if len(candidate) > CHUNK_LIMIT and buf:
            parts.append(buf)
            buf = f"{sentence}."
        else:
            buf = candidate
    if buf:
        parts.append(buf)
    return parts or [text]


def to_wav(chunks: list[torch.Tensor]) -> bytes:
    audio = torch.cat(chunks) if len(chunks) > 1 else chunks[0]
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes((audio * 32767).to(torch.int16).numpy().tobytes())
    return out.getvalue()


def to_ogg(wav_bytes: bytes) -> bytes:
    """Перекодирует в ogg/opus — формат голосовых сообщений Telegram."""
    proc = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", "pipe:0",
         "-c:a", "libopus", "-b:a", "48k", "-f", "ogg", "pipe:1"],
        input=wav_bytes, capture_output=True,
    )
    if proc.returncode != 0:
        raise HTTPException(500, f"ffmpeg: {proc.stderr.decode()[:200]}")
    return proc.stdout


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    speaker: str = DEFAULT_SPEAKER
    format: str = "ogg"


@app.get("/health")
def health():
    return {"status": "ok", "model": "v4_ru", "speakers": SPEAKERS,
            "default_speaker": DEFAULT_SPEAKER}


@app.post("/tts")
def tts(req: TtsRequest):
    if req.speaker not in SPEAKERS:
        raise HTTPException(400, f"unknown speaker: {req.speaker}")
    if req.format not in ("ogg", "wav"):
        raise HTTPException(400, f"unknown format: {req.format}")

    model = get_model()
    chunks = [
        model.apply_tts(text=part, speaker=req.speaker,
                        sample_rate=SAMPLE_RATE, put_accent=True, put_yo=True)
        for part in split_text(req.text)
    ]
    wav = to_wav(chunks)
    if req.format == "wav":
        return Response(wav, media_type="audio/wav")
    return Response(to_ogg(wav), media_type="audio/ogg")
