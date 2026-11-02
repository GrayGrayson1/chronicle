"""Record ONE device in the main thread. Launch once for mic and once for loopback."""
import argparse
import json
import os
from pathlib import Path
import sys
import threading
import time
import uuid
import wave


def emit(data):
    print(json.dumps(data), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["mic", "system"], required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--started", type=float, required=True)
    args = parser.parse_args()
    import numpy as np
    import soundcard as sc

    if args.source == "mic":
        name = os.getenv("MIC_DEVICE", "")
        device = sc.get_microphone(name) if name else sc.default_microphone()
    else:
        name = os.getenv("PLAYBACK_DEVICE", "")
        speaker = sc.get_speaker(name) if name else sc.default_speaker()
        if speaker is None:
            raise RuntimeError("No playback device found.")
        device = sc.get_microphone(speaker.id, include_loopback=True)
    if device is None:
        raise RuntimeError("Recording device unavailable. Set MIC_DEVICE / PLAYBACK_DEVICE.")
    stopping = threading.Event()

    def listen():
        sys.stdin.readline()
        stopping.set()

    threading.Thread(target=listen, daemon=True).start()
    directory = Path(args.output)
    directory.mkdir(parents=True, exist_ok=True)
    rate = 48000
    pieces = []
    frames = 0
    offset = 0

    def flush():
        nonlocal pieces, frames
        if not pieces:
            return
        samples = np.concatenate(pieces, axis=0)
        samples = np.nan_to_num(samples)
        samples = (np.clip(samples, -1, 1) * 32767).astype("<i2")
        pieces = []
        frames = 0
        path = directory / (str(uuid.uuid4()) + ".wav")
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(samples.tobytes())
        emit({"path": str(path.resolve()), "offset": offset, "source": args.source})

    # Record native channel count, then downmix. Selecting a single WASAPI channel
    # can yield corrupt audio on some Windows devices.
    with device.recorder(samplerate=rate) as recorder:
        emit({"ready": True, "source": args.source, "device": str(device.name)})
        while not stopping.is_set():
            at = time.time()
            samples = recorder.record(numframes=4800)
            if frames == 0:
                offset = max(0, at - args.started)
            samples = samples.mean(axis=1) if samples.ndim > 1 else samples
            pieces.append(samples)
            frames += len(samples)
            if frames >= rate * 30:
                flush()
        flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"error": str(exc)[:500]})
        sys.exit(1)
