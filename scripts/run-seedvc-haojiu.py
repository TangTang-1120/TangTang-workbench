#!/usr/bin/env python3
"""Run Seed-VC SVC on 好久不见 guide with 汤汤 reference, then remux to video."""
from __future__ import annotations

import os
import sys
import glob
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "tools" / "seed-vc"
CKPT = SEED / "checkpoints"
OUT_DIR = ROOT / "output" / "voice-demo"
SOURCE = Path(os.environ.get("SEEDVC_SOURCE", str(OUT_DIR / "source-haojiu-guide.wav")))
TARGET = Path(os.environ.get("SEEDVC_TARGET", str(OUT_DIR / "ref-tangtang.wav")))
VIDEO_IN = ROOT / "output" / "jobs" / "hao-jiu-bu-jian" / "唱音阶.mp4"
CELLO = ROOT / "output" / "jobs" / "hao-jiu-bu-jian" / "stems" / "大提琴.wav"
DESKTOP_OUT = Path.home() / "Desktop" / "好久不见-汤汤音色跟唱样片.mp4"
FF = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg"
DIFFUSION_STEPS = int(os.environ.get("SEEDVC_STEPS", "20"))
VIDEO_SS = os.environ.get("SEEDVC_VIDEO_SS", "")  # e.g. 3.3
VIDEO_T = os.environ.get("SEEDVC_VIDEO_T", "")  # e.g. 40


DIT = CKPT / "DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth"
CFG = SEED / "configs" / "presets" / "config_dit_mel_seed_uvit_whisper_base_f0_44k.yml"
CFG_LOCAL = CKPT / "config_local_haojiu.yml"
WHISPER_DIR = CKPT / "whisper-small"
BIGVGAN_DIR = CKPT / "bigvgan_v2_44khz_128band_512x"
SEEDVC_OUT = OUT_DIR / "seedvc-out"
FINAL_WAV = OUT_DIR / "hao-jiu-bu-jian-seedvc-tangtang.wav"
FINAL_MP4 = OUT_DIR / "hao-jiu-bu-jian-seedvc-tangtang.mp4"

EXPECTED_DIT = 820_000_000  # ~782MB


def require_files() -> None:
    missing = [p for p in (SOURCE, TARGET, VIDEO_IN, DIT, CFG) if not p.exists()]
    if missing:
        raise SystemExit("缺少文件:\n" + "\n".join(str(p) for p in missing))
    size = DIT.stat().st_size
    if size < EXPECTED_DIT:
        raise SystemExit(f"DiT 权重未下完: {size} bytes < {EXPECTED_DIT}")
    for p, min_sz in (
        (WHISPER_DIR / "model.safetensors", 400_000_000),
        (WHISPER_DIR / "config.json", 100),
        (BIGVGAN_DIR / "bigvgan_generator.pt", 100_000_000),
        (BIGVGAN_DIR / "config.json", 100),
        (CKPT / "rmvpe.pt", 100_000_000),
        (CKPT / "campplus_cn_common.bin", 20_000_000),
    ):
        if not p.exists() or p.stat().st_size < min_sz:
            raise SystemExit(f"依赖未就绪: {p}")


def write_local_config() -> Path:
    import yaml

    with open(CFG, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    cfg["model_params"]["speech_tokenizer"]["name"] = str(WHISPER_DIR)
    cfg["model_params"]["vocoder"]["name"] = str(BIGVGAN_DIR)
    with open(CFG_LOCAL, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    return CFG_LOCAL


def patch_hf_utils() -> None:
    import hf_utils  # type: ignore

    orig = hf_utils.load_custom_model_from_hf
    local_map = {
        ("lj1995/VoiceConversionWebUI", "rmvpe.pt"): CKPT / "rmvpe.pt",
        ("funasr/campplus", "campplus_cn_common.bin"): CKPT / "campplus_cn_common.bin",
    }

    def wrapped(repo_id, model_filename="pytorch_model.bin", config_filename=None):
        local = local_map.get((repo_id, model_filename))
        if local is not None and local.is_file() and local.stat().st_size > 1_000_000:
            print(f"[local] {repo_id}/{model_filename} -> {local}")
            if config_filename is None:
                return str(local)
            # still need config from hub if requested with model
            return orig(repo_id, model_filename, config_filename)
        return orig(repo_id, model_filename, config_filename)

    hf_utils.load_custom_model_from_hf = wrapped


def run_inference() -> Path:
    os.chdir(SEED)
    sys.path.insert(0, str(SEED))
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    os.environ["HF_HUB_CACHE"] = str(CKPT)
    os.environ["TRANSFORMERS_CACHE"] = str(CKPT / "hf_cache")
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(CKPT)

    patch_hf_utils()
    local_cfg = write_local_config()

    SEEDVC_OUT.mkdir(parents=True, exist_ok=True)
    # clear prior vc_*.wav
    for old in SEEDVC_OUT.glob("vc_*.wav"):
        old.unlink()

    sys.argv = [
        "inference.py",
        "--source",
        str(SOURCE),
        "--target",
        str(TARGET),
        "--output",
        str(SEEDVC_OUT),
        "--f0-condition",
        "True",
        "--semi-tone-shift",
        "4",
        "--fp16",
        "False",
        "--diffusion-steps",
        str(DIFFUSION_STEPS),
        "--checkpoint",
        str(DIT),
        "--config",
        str(local_cfg),
    ]
    import runpy

    runpy.run_path(str(SEED / "inference.py"), run_name="__main__")
    waves = sorted(SEEDVC_OUT.glob("vc_*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not waves:
        raise SystemExit("Seed-VC 未产出 wav")
    return waves[0]


def remux(vc_wav: Path) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 只唱不拉：默认不加大提琴；SEEDVC_WITH_CELLO=1 才混入
    with_cello = os.environ.get("SEEDVC_WITH_CELLO", "0") == "1"
    if with_cello and CELLO.exists():
        mix = OUT_DIR / "_seedvc_mix.wav"
        subprocess.check_call(
            [
                str(FF),
                "-y",
                "-i",
                str(vc_wav),
                "-i",
                str(CELLO),
                "-filter_complex",
                "[0:a]volume=1.0[v];[1:a]volume=0.18[c];[v][c]amix=inputs=2:duration=first:dropout_transition=0[a]",
                "-map",
                "[a]",
                str(mix),
            ]
        )
        audio = mix
    else:
        # 轻微提亮辅音/唱名区，便于听出哆来咪发索拉西
        clear = OUT_DIR / "_seedvc_voice_clear.wav"
        subprocess.check_call(
            [
                str(FF),
                "-y",
                "-i",
                str(vc_wav),
                "-af",
                "highpass=f=80,equalizer=f=2500:t=q:w=1.2:g=4,equalizer=f=4500:t=q:w=1.4:g=3,loudnorm=I=-14:TP=-1.5:LRA=11",
                str(clear),
            ]
        )
        audio = clear

    cmd = [
        str(FF),
        "-y",
    ]
    if VIDEO_SS:
        cmd += ["-ss", VIDEO_SS]
    if VIDEO_T:
        cmd += ["-t", VIDEO_T]
    cmd += [
        "-i",
        str(VIDEO_IN),
        "-i",
        str(audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        str(FINAL_MP4),
    ]
    subprocess.check_call(cmd)
    subprocess.check_call(["cp", str(vc_wav), str(FINAL_WAV)])
    subprocess.check_call(["cp", str(FINAL_MP4), str(DESKTOP_OUT)])
    print(f"OK desktop: {DESKTOP_OUT}")
    print(f"OK project: {FINAL_MP4}")


def main() -> None:
    require_files()
    vc = run_inference()
    print("VC wav:", vc)
    remux(vc)


if __name__ == "__main__":
    main()
