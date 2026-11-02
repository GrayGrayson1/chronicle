"""Optional local speaker discovery. Speakers remain anonymous until user mapping."""
import json
import os
from pathlib import Path
import sys
import uuid
import wave

import av
import numpy as np
import torch
from pyannote.audio import Pipeline

request = json.load(sys.stdin)
path = Path(request["path"])
directory = Path(request["output"])
directory.mkdir(parents=True, exist_ok=True)
# Decode through PyAV so this path does not depend on pyannote's FFmpeg loader.
parts = []
with av.open(str(path)) as audio:
    resampler = av.audio.resampler.AudioResampler(format="flt", layout="mono", rate=16000)
    for frame in audio.decode(audio=0):
        for converted in resampler.resample(frame):
            parts.append(converted.to_ndarray().reshape(-1))
    for converted in resampler.resample(None):
        parts.append(converted.to_ndarray().reshape(-1))
samples = np.concatenate(parts).astype(np.float32)
pipeline = Pipeline.from_pretrained(os.getenv("DIARIZATION_MODEL", "pyannote/speaker-diarization-community-1"), token=os.getenv("HF_TOKEN") or None)
if os.getenv("DIARIZATION_DEVICE") == "cuda":
    pipeline.to(torch.device("cuda"))
output = pipeline({"waveform": torch.from_numpy(samples).unsqueeze(0), "sample_rate": 16000})
diarization = getattr(output, "exclusive_speaker_diarization", None) or getattr(output, "speaker_diarization", output)
segments = []
for turn, _, speaker in diarization.itertracks(yield_label=True):
    for start in np.arange(turn.start, turn.end, 30):
        end = min(float(start) + 30, turn.end)
        if end - start < 0.25:
            continue
        target = directory / (str(uuid.uuid4()) + ".wav")
        pcm = (np.clip(samples[int(start * 16000):int(end * 16000)], -1, 1) * 32767).astype("<i2")
        with wave.open(str(target), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(pcm.tobytes())
        segments.append({"speaker": speaker, "offset": float(start), "duration": end - start, "path": str(target.resolve())})
print(json.dumps({"segments": segments, "speakers": sorted({s["speaker"] for s in segments})}))
