#!/usr/bin/env python3
"""Extract speech-optimized audio from a video and transcribe it with mlx-whisper (on-device, English)."""
import argparse
import csv
import os
import subprocess
import sys
import tempfile

#edit here if transcription not coming out well
AUDIO_FILTERS = "highpass=f=80,afftdn=nf=-25,loudnorm,acompressor=threshold=-18dB:ratio=3:attack=20:release=250"

# swap here if a different downloaded mlx-community model is preferred.
MODEL = "mlx-community/whisper-large-v3-mlx"


def build_ffmpeg_cmd(video_path, out_path, filters):
    return ["ffmpeg", "-y", "-i", video_path, "-af", filters, "-ar", "16000", "-ac", "1", out_path]


def extract_audio(video_path, out_path, filters=AUDIO_FILTERS):
    subprocess.run(build_ffmpeg_cmd(video_path, out_path, filters), check=True, capture_output=True)


def transcribe_local(audio_path):
    import mlx_whisper

    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo=MODEL,
        language="en",
        temperature=0,  # deterministic, no sampling variance across runs
        condition_on_previous_text=False,  # avoids repetition-loop hallucinations on disfluent speech
    )
    return {"text": result["text"], "segments": result["segments"]}


def format_timestamp(seconds):
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def csv_rows(result, timestamps):
    if timestamps:
        return [
            (f"{format_timestamp(seg['start'])} --> {format_timestamp(seg['end'])}", seg["text"].strip())
            for seg in result["segments"]
        ]
    return [(format_timestamp(seg["start"]), seg["text"].strip()) for seg in result["segments"]]


def write_csv(result, output_path, timestamps):
    f = open(output_path, "w", newline="") if output_path else sys.stdout
    writer = csv.writer(f)
    writer.writerow(["time", "text"])
    writer.writerows(csv_rows(result, timestamps))
    if output_path:
        f.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("video", help="input video file")
    p.add_argument("-o", "--output", help="transcript CSV output path (default: stdout)")
    p.add_argument("--timestamps", action="store_true", help="use a 'start --> end' range in the time column instead of just the start time")
    args = p.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        audio_path = os.path.join(tmp, "audio.wav")
        extract_audio(args.video, audio_path)
        result = transcribe_local(audio_path)

    if args.output:
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    write_csv(result, args.output, args.timestamps)


if __name__ == "__main__":
    main()
