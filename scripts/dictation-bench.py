from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import tarfile
import time
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent / "dictation-bench"
RATE = 16_000
LIVE_STEP = 0.5
SHERPA = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"

def threads() -> int:
    return max(1, min(4, os.cpu_count() or 1))

def fetched(models: Path, name: str) -> Path:
    folder = models / name
    if folder.is_dir():
        return folder
    models.mkdir(parents=True, exist_ok=True)
    archive = models / f"{name}.tar.bz2"
    if not archive.exists():
        print(f"  fetching {name}", flush=True)
        urllib.request.urlretrieve(f"{SHERPA}{name}.tar.bz2", archive)
    with tarfile.open(archive) as tar:
        tar.extractall(models, filter="data")
    archive.unlink()
    return folder

def size_of(folder: Path) -> float:
    return sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) / 1e6

def bpe_vocab(folder: Path) -> str:
    vocab = folder / "bpe.vocab"
    if not vocab.exists():
        lines = (folder / "tokens.txt").read_text(encoding="utf-8").splitlines()
        pieces = [line.rsplit(" ", 1)[0] for line in lines if line.strip()]
        vocab.write_text("".join(f"{p}\t{-i}\n" for i, p in enumerate(pieces)), encoding="utf-8")
    return str(vocab)

class Offline:

    streaming = False

    def __init__(self, recognizer, hotwords=None, options=None):
        self.recognizer = recognizer
        self.hotwords = hotwords
        self.options = options or {}

    def hear(self, samples: np.ndarray, context: list[str]) -> str:
        if self.hotwords and context:
            stream = self.recognizer.create_stream(hotwords=self.hotwords(context))
        else:
            stream = self.recognizer.create_stream()
        for name, value in self.options.items():
            stream.set_option(name, value(context) if callable(value) else value)
        stream.accept_waveform(RATE, samples)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()

class Streaming:

    streaming = True
    CHUNK = 0.16

    def __init__(self, recognizer):
        self.recognizer = recognizer

    def run(self, samples: np.ndarray) -> tuple[str, list[float], str, float]:
        stream = self.recognizer.create_stream()
        chunk = int(self.CHUNK * RATE)
        steps: list[float] = []
        live = ""
        for at in range(0, len(samples), chunk):
            t0 = time.perf_counter()
            stream.accept_waveform(RATE, samples[at : at + chunk])
            while self.recognizer.is_ready(stream):
                self.recognizer.decode_stream(stream)
            steps.append(time.perf_counter() - t0)
            live = self.recognizer.get_result(stream)
        t0 = time.perf_counter()
        stream.accept_waveform(RATE, np.zeros(int(0.4 * RATE), dtype=np.float32))
        stream.input_finished()
        while self.recognizer.is_ready(stream):
            self.recognizer.decode_stream(stream)
        final = self.recognizer.get_result(stream)
        return final.strip(), steps, live.strip(), time.perf_counter() - t0

    def hear(self, samples: np.ndarray, context: list[str]) -> str:
        return self.run(samples)[0]

class FasterWhisper:
    streaming = False

    def __init__(self, model):
        self.model = model

    def hear(self, samples: np.ndarray, context: list[str]) -> str:
        prompt = ", ".join(context) + "." if context else None
        parts, _ = self.model.transcribe(
            samples, beam_size=1, initial_prompt=prompt, vad_filter=False, condition_on_previous_text=False
        )
        return " ".join(p.text.strip() for p in parts).strip()

def parakeet(models: Path, beam: bool, score: float = 1.5):
    import sherpa_onnx

    d = fetched(models, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")
    extra = (
        dict(decoding_method="modified_beam_search", modeling_unit="bpe", bpe_vocab=bpe_vocab(d), hotwords_score=score)
        if beam
        else {}
    )
    r = sherpa_onnx.OfflineRecognizer.from_transducer(
        str(d / "encoder.int8.onnx"), str(d / "decoder.int8.onnx"), str(d / "joiner.int8.onnx"),
        str(d / "tokens.txt"), num_threads=threads(), model_type="nemo_transducer", **extra,
    )
    return Offline(r, hotwords=(lambda c: "/".join(c)) if beam else None), d

def nemotron(models: Path, ms: int):
    import sherpa_onnx

    d = fetched(models, f"sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{ms}ms-int8-2026-06-11")
    r = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(d / "tokens.txt"), encoder=str(d / "encoder.int8.onnx"),
        decoder=str(d / "decoder.int8.onnx"), joiner=str(d / "joiner.int8.onnx"), num_threads=threads(),
    )
    engine = Streaming(r)
    engine.CHUNK = ms / 1000
    return engine, d

def qwen3(models: Path):
    import sherpa_onnx

    d = fetched(models, "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25")
    r = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
        conv_frontend=str(d / "conv_frontend.onnx"), encoder=str(d / "encoder.int8.onnx"),
        decoder=str(d / "decoder.int8.onnx"), tokenizer=str(d / "tokenizer"),
        num_threads=threads(), max_new_tokens=256,
    )
    return Offline(r, options={"hotwords": lambda c: ",".join(c)}), d

def sherpa_whisper(models: Path, name: str):
    import sherpa_onnx

    d = fetched(models, f"sherpa-onnx-whisper-{name}")
    enc = next(d.glob("*-encoder.int8.onnx"))
    dec = next(d.glob("*-decoder.int8.onnx"))
    tok = next(d.glob("*-tokens.txt"))
    r = sherpa_onnx.OfflineRecognizer.from_whisper(
        str(enc), str(dec), str(tok), language="", num_threads=threads()
    )
    return Offline(r), d

def moonshine(models: Path):
    import sherpa_onnx

    d = fetched(models, "sherpa-onnx-moonshine-base-en-quantized-2026-02-27")
    enc = next(d.glob("encoder*.ort"), None) or next(d.glob("encoder*.onnx"))
    dec = next(d.glob("decoder*.ort"), None) or next(d.glob("decoder*.onnx"))
    r = sherpa_onnx.OfflineRecognizer.from_moonshine_v2(
        str(enc), str(dec), str(d / "tokens.txt"), num_threads=threads()
    )
    return Offline(r), d

def faster_whisper(models: Path, name: str):
    from faster_whisper import WhisperModel

    root = models / "faster-whisper"
    model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads(), download_root=str(root))
    return FasterWhisper(model), root

ENGINES = {
    "parakeet-v3": (lambda m: parakeet(m, False), "CC BY 4.0", False),
    "parakeet-v3-hotwords": (lambda m: parakeet(m, True), "CC BY 4.0", True),
    "parakeet-v3-hotwords-1.0": (lambda m: parakeet(m, True, 1.0), "CC BY 4.0", True),
    "nemotron-3.5-160ms": (lambda m: nemotron(m, 160), "OpenMDW-1.1", False),
    "nemotron-3.5-560ms": (lambda m: nemotron(m, 560), "OpenMDW-1.1", False),
    "qwen3-asr-0.6b": (qwen3, "Apache-2.0", False),
    "qwen3-asr-0.6b-hotwords": (qwen3, "Apache-2.0", True),
    "whisper-turbo-sherpa": (lambda m: sherpa_whisper(m, "turbo"), "MIT", False),
    "moonshine-base-en": (moonshine, "MIT", False),
    "fw-large-v3-turbo": (lambda m: faster_whisper(m, "large-v3-turbo"), "MIT", False),
    "fw-large-v3-turbo-prompt": (lambda m: faster_whisper(m, "large-v3-turbo"), "MIT", True),
    "fw-small-prompt": (lambda m: faster_whisper(m, "small"), "MIT", True),
}

def norm(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text).lower().replace("-", " ")
    return re.sub(r"[^\w\s']", " ", text).split()

def edits(ref: list[str], hyp: list[str]) -> int:
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, row[0] = row[0], i
        for j, h in enumerate(hyp, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (r != h))
    return row[-1]

def wer(pairs: list[tuple[str, str]]) -> float:
    words = sum(len(norm(r)) for r, _ in pairs)
    return sum(edits(norm(r), norm(h)) for r, h in pairs) / max(1, words)

def recordings() -> tuple[list[dict], list[str]]:
    doc = json.loads((HERE / "samples.json").read_text(encoding="utf-8"))
    rng = np.random.default_rng(7)
    out = []
    for s in doc["samples"]:
        x, sr = sf.read(HERE / s["file"], dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if sr != RATE:
            n = int(len(x) * RATE / sr)
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
        if s["kind"].startswith("tts"):
            power = float(np.mean(x**2))
            x = x + rng.normal(0, np.sqrt(power / 10 ** 2.5), len(x)).astype(np.float32)
        room = rng.normal(0, 0.002, RATE // 4).astype(np.float32)
        out.append({**s, "samples": np.concatenate([room, x, room]).astype(np.float32)})
    return out, doc["context"]

def group(s: dict) -> str:
    if s["kind"] == "real-phone":
        return "phone"
    return "mixed" if "+" in s["lang"] else "mono"

def measure(name: str, models: Path, samples: list[dict], context: list[str]) -> dict:
    make, licence, takes_context = ENGINES[name]
    t0 = time.perf_counter()
    engine, folder = make(models)
    loaded = time.perf_counter() - t0
    english_only = name.startswith("moonshine")
    rows = []
    lives: list[float] = []
    for s in samples:
        if english_only and s["lang"] != "en":
            continue
        x = s["samples"]
        words = context if takes_context and s["kind"] != "real-phone" else []
        live = ""
        if engine.streaming:
            final, steps, live, took = engine.run(x)
            if s["kind"] != "real-phone":
                lives.extend(steps)
        else:
            if s["kind"] != "real-phone":
                step = int(LIVE_STEP * RATE)
                for to in range(step, len(x), step):
                    t1 = time.perf_counter()
                    live = engine.hear(x[:to], words)
                    lives.append(time.perf_counter() - t1)
            t1 = time.perf_counter()
            final = engine.hear(x, words)
            took = time.perf_counter() - t1
        rows.append({"file": s["file"], "group": group(s), "ref": s["ref"], "final": final, "live": live,
                     "seconds": len(x) / RATE, "took": took, "terms": s.get("terms", [])})
        print(f"  {s['file']:20} {took:6.2f}s  {final}", flush=True)

    def part(g: str) -> str:
        pairs = [(r["ref"], r["final"]) for r in rows if r["group"] == g]
        return f"{wer(pairs):.3f}" if pairs else "-"

    named = [(t, r["final"]) for r in rows for t in r["terms"]]
    dictation = [r for r in rows if r["group"] != "phone"]
    return {
        "engine": name, "licence": licence, "mb": round(size_of(folder)), "load": round(loaded, 1),
        "mixed": part("mixed"), "mono": part("mono"), "phone": part("phone"),
        "live_wer": f"{wer([(r['ref'], r['live']) for r in dictation]):.3f}" if dictation else "-",
        "names": f"{sum(t in h for t, h in named)}/{len(named)}",
        "final_s": round(statistics.mean(r["took"] for r in dictation), 2) if dictation else None,
        "rtf": round(sum(r["took"] for r in rows) / sum(r["seconds"] for r in rows), 3),
        "live_p50": round(statistics.median(lives), 2) if lives else None,
        "live_max": round(max(lives), 2) if lives else None,
        "rows": rows,
    }

def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--models", type=Path, default=Path.home() / ".cache" / "orden-bench")
    p.add_argument("--only", default=",".join(ENGINES))
    p.add_argument("--out", type=Path)
    p.add_argument("--export", type=Path, help="write the recordings as 16 kHz f32 for the app's own test")
    args = p.parse_args()
    samples, context = recordings()
    if args.export:
        args.export.mkdir(parents=True, exist_ok=True)
        for s in samples:
            s["samples"].astype("<f4").tofile(args.export / f"{s['file']}.f32")
        listed = [{"file": s["file"], "ref": s["ref"], "group": group(s), "terms": s.get("terms", [])} for s in samples]
        (args.export / "samples.json").write_text(json.dumps(listed, ensure_ascii=False), encoding="utf-8")
        (args.export / "context.txt").write_text("\n".join(context), encoding="utf-8")
        return
    results = []
    for name in args.only.split(","):
        print(f"{name}", flush=True)
        try:
            results.append(measure(name, args.models, samples, context))
        except Exception as error:
            print(f"  failed: {error!r}", flush=True)
            results.append({"engine": name, "error": repr(error)})
    head = "| engine | licence | MB | mixed WER | DE/EN WER | phone WER | names | live WER | live s (p50/max) | final s | RTF | load s |"
    print("\n" + head)
    print("|" + " --- |" * (head.count("|") - 1))
    for r in results:
        if "error" in r:
            print(f"| {r['engine']} | failed: {r['error'][:80]} |")
            continue
        print(f"| {r['engine']} | {r['licence']} | {r['mb']} | {r['mixed']} | {r['mono']} | {r['phone']} | {r['names']} "
              f"| {r['live_wer']} | {r['live_p50']}/{r['live_max']} | {r['final_s']} | {r['rtf']} | {r['load']} |")
    if args.out:
        args.out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
