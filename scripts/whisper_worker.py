"""One persistent model, newline-delimited JSON requests/responses, no API service."""
import json
import os
import sys


def main():
    # Import/model downloads may write status messages to stderr, never stdout.
    from faster_whisper import WhisperModel
    model = WhisperModel(
        os.getenv("WHISPER_MODEL", "large-v3"),
        device=os.getenv("WHISPER_DEVICE", "cuda"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "float16"),
    )
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            language = request.get("language") or os.getenv("WHISPER_LANGUAGE", "en") or None
            if language in ("auto", "mixed"):
                language = None
            segments, _ = model.transcribe(
                request["path"],
                language=language,
                vad_filter=True,
                beam_size=5,
                condition_on_previous_text=False,
                initial_prompt=request.get("glossary", "")[:1000] or None,
            )
            result = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments if s.text.strip()]
            print(json.dumps({"id": request["id"], "segments": result}), flush=True)
        except Exception as exc:
            print(json.dumps({"id": request.get("id") if isinstance(request, dict) else None, "error": str(exc)[:500]}), flush=True)


if __name__ == "__main__":
    main()
