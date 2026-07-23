#!/usr/bin/env python3
"""
Batch Seed-VC: convert gallery solfege tracks to TangTang timbre (voice-only).
Usage:
  tools/seed-vc/.venv/bin/python scripts/batch-seedvc-gallery.py
  SEEDVC_JOBS=hao-jiu-bu-jian,first-love tools/seed-vc/.venv/bin/python scripts/batch-seedvc-gallery.py
"""
from __future__ import annotations

import os
import sys
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "tools" / "seed-vc"
CKPT = SEED / "checkpoints"
OUT_DIR = ROOT / "output" / "voice-demo"
GALLERY = ROOT / "output" / "gallery"
DOCS_GALLERY = ROOT / "docs" / "gallery"
FF = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg"
REF = Path(os.environ.get("SEEDVC_TARGET", str(OUT_DIR / "ref-tangtang-10s.wav")))
DIFFUSION_STEPS = int(os.environ.get("SEEDVC_STEPS", "20"))
SEMI = int(os.environ.get("SEEDVC_SEMI", "0"))

DIT = CKPT / "DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth"
CFG = SEED / "configs" / "presets" / "config_dit_mel_seed_uvit_whisper_base_f0_44k.yml"
CFG_LOCAL = CKPT / "config_local_haojiu.yml"
WHISPER_DIR = CKPT / "whisper-small"
BIGVGAN_DIR = CKPT / "bigvgan_v2_44khz_128band_512x"

# gallery_id -> job folder for stems/video (omr reuses yi-bu audio)
GALLERY_JOBS = [
    {
        "id": "hao-jiu-bu-jian",
        "job": "hao-jiu-bu-jian",
        "title": "好久不见",
        "artist": "陈奕迅",
        "pos_label": "一把位",
    },
    {
        "id": "yi-bu-zhi-yao",
        "job": "yi-bu-zhi-yao",
        "title": "一步之遥",
        "artist": "Carlos Gardel",
        "pos_label": "一把位",
    },
    {
        "id": "omr-11111100",
        "job": "yi-bu-zhi-yao",  # same score audio; video from docs/jobs gallery frames
        "video_job": "yi-bu-zhi-yao",
        "title": "一步之遥 · OMR",
        "artist": "未知歌手",
        "pos_label": "一把位",
        "reuse_vc_from": "yi-bu-zhi-yao",
    },
    {
        "id": "moon-river-first",
        "job": "moon-river-first",
        "title": "Moon River",
        "artist": "Henry Mancini",
        "pos_label": "一把位",
    },
    {
        "id": "moon-river-multi",
        "job": "moon-river-multi",
        "title": "Moon River",
        "artist": "Henry Mancini",
        "pos_label": "多把位",
    },
    {
        "id": "first-love",
        "job": "first-love",
        "title": "First Love",
        "artist": "Utada Hikaru",
        "pos_label": "多把位",
        "add_to_gallery": True,
    },
]


def ff(*args: str) -> None:
    subprocess.check_call([str(FF), "-y", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def find_solfege_video(job: Path) -> Path:
    for name in ("唱音阶.mp4", "唱音階.mp4"):
        p = job / name
        if p.exists():
            return p
    raise FileNotFoundError(f"no solfege mp4 in {job}")


def find_cello_video(job: Path) -> Path:
    for name in ("大提琴.mp4",):
        p = job / name
        if p.exists():
            return p
    raise FileNotFoundError(f"no cello mp4 in {job}")


def find_solfege_wav(job: Path) -> Path:
    stems = job / "stems"
    for name in ("唱音阶.wav", "唱音階.wav"):
        p = stems / name
        if p.exists():
            return p
    raise FileNotFoundError(f"no solfege wav in {job}")


def ensure_ref() -> None:
    if REF.exists() and REF.stat().st_size > 100_000:
        return
    src = Path("/Users/tangtang/Downloads/汤汤音色.m4a")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not src.exists():
        raise SystemExit(f"缺少参考音色: {REF} 或 {src}")
    ff("-ss", "1.2", "-t", "10", "-i", str(src), "-ac", "1", "-ar", "44100", str(REF))


def require_models() -> None:
    if not DIT.exists() or DIT.stat().st_size < 820_000_000:
        raise SystemExit("Seed-VC DiT 权重未就绪")
    for p in (
        WHISPER_DIR / "model.safetensors",
        BIGVGAN_DIR / "bigvgan_generator.pt",
        CKPT / "rmvpe.pt",
        CKPT / "campplus_cn_common.bin",
    ):
        if not p.exists():
            raise SystemExit(f"缺少模型: {p}")


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
            return orig(repo_id, model_filename, config_filename)
        return orig(repo_id, model_filename, config_filename)

    hf_utils.load_custom_model_from_hf = wrapped


_models_ready = False


def seed_vc_convert(source: Path, out_wav: Path) -> Path:
    """Run Seed-VC; write result to out_wav. Returns out_wav."""
    global _models_ready
    os.chdir(SEED)
    if str(SEED) not in sys.path:
        sys.path.insert(0, str(SEED))
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    os.environ["HF_HUB_CACHE"] = str(CKPT)
    os.environ["TRANSFORMERS_CACHE"] = str(CKPT / "hf_cache")
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(CKPT)

    if not _models_ready:
        patch_hf_utils()
        write_local_config()
        _models_ready = True

    work = OUT_DIR / "seedvc-batch-tmp"
    work.mkdir(parents=True, exist_ok=True)
    for old in work.glob("vc_*.wav"):
        old.unlink()

    sys.argv = [
        "inference.py",
        "--source",
        str(source),
        "--target",
        str(REF),
        "--output",
        str(work),
        "--f0-condition",
        "True",
        "--semi-tone-shift",
        str(SEMI),
        "--fp16",
        "False",
        "--diffusion-steps",
        str(DIFFUSION_STEPS),
        "--checkpoint",
        str(DIT),
        "--config",
        str(CFG_LOCAL),
    ]
    import runpy

    runpy.run_path(str(SEED / "inference.py"), run_name="__main__")
    waves = sorted(work.glob("vc_*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not waves:
        raise SystemExit(f"Seed-VC 未产出: {source}")
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(waves[0], out_wav)
    return out_wav


def remux_voice_only(vc_wav: Path, video_in: Path, out_mp4: Path) -> None:
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    ff(
        "-i",
        str(video_in),
        "-i",
        str(vc_wav),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        str(out_mp4),
    )


def positions_summary(job: Path) -> list[int]:
    fj = job / "fingerings.json"
    if not fj.exists():
        return []
    data = json.loads(fj.read_text(encoding="utf-8"))
    return sorted({int(n["position"]) for n in data.get("notes", []) if n.get("position") is not None})


def safe_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.resolve() == dst.resolve():
        return
    shutil.copy2(src, dst)


def publish_entry(entry: dict, solfege_mp4: Path, cello_mp4: Path) -> None:
    gid = entry["id"]
    for base in (GALLERY / gid, DOCS_GALLERY / gid):
        base.mkdir(parents=True, exist_ok=True)
        safe_copy(solfege_mp4, base / "solfege.mp4")
        safe_copy(cello_mp4, base / "cello.mp4")
        # keep poster if exists
        src_poster = GALLERY / gid / "poster.jpg"
        if not src_poster.exists():
            # grab from docs or extract
            docs_poster = DOCS_GALLERY / gid / "poster.jpg"
            if docs_poster.exists() and base == GALLERY / gid:
                safe_copy(docs_poster, src_poster)
        if (GALLERY / gid / "poster.jpg").exists() and base == DOCS_GALLERY / gid:
            safe_copy(GALLERY / gid / "poster.jpg", base / "poster.jpg")


def update_manifest(entries_meta: list[dict]) -> None:
    import time

    now = int(time.time() * 1000)
    # Preserve order: multi-position first for visibility, then rest
    by_id = {e["id"]: e for e in entries_meta}
    order = [
        "moon-river-multi",
        "moon-river-first",
        "first-love",
        "hao-jiu-bu-jian",
        "yi-bu-zhi-yao",
        "omr-11111100",
    ]
    entries = []
    for i in order:
        if i not in by_id:
            continue
        e = by_id[i]
        entries.append(
            {
                "id": e["id"],
                "title": e["title"],
                "artist": e.get("artist", ""),
                "hasPoster": True,
                "posLabel": e.get("pos_label", ""),
                "addedAt": now,
                "updatedAt": now,
            }
        )
    payload = {"entries": entries}
    for path in (GALLERY / "manifest.json", DOCS_GALLERY / "manifest.json"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path}")


def process_one(entry: dict, vc_cache: dict[str, Path]) -> Path:
    job_id = entry["job"]
    job = ROOT / "output" / "jobs" / job_id
    video_job = ROOT / "output" / "jobs" / entry.get("video_job", job_id)
    reuse = entry.get("reuse_vc_from")

    print(f"\n==== {entry['id']} (job={job_id}) ====")
    pos = positions_summary(job)
    print(f"把位 positions={pos} → 标识={entry['pos_label']}")

    vc_path = OUT_DIR / f"vc-{entry['id']}.wav"
    if reuse:
        src = vc_cache.get(reuse) or (OUT_DIR / f"vc-{reuse}.wav")
        if not (isinstance(src, Path) and src.exists()):
            raise FileNotFoundError(f"reuse VC missing for {reuse}")
        print(f"reuse VC from {reuse}")
        if src.resolve() != vc_path.resolve():
            shutil.copy2(src, vc_path)
        else:
            vc_path = src
    elif vc_path.exists() and os.environ.get("SEEDVC_FORCE") != "1":
        print(f"skip convert, use cached {vc_path}")
    else:
        guide = find_solfege_wav(job)
        # normalize to 44.1k mono
        guide_norm = OUT_DIR / f"guide-{entry['id']}.wav"
        ff("-i", str(guide), "-ac", "1", "-ar", "44100", str(guide_norm))
        print(f"Seed-VC convert {guide_norm} ...")
        seed_vc_convert(guide_norm, vc_path)
    vc_cache[entry["id"]] = vc_path
    if job_id not in vc_cache:
        vc_cache[job_id] = vc_path

    # Prefer original gallery video frames if present (keeps OMR visuals)
    docs_sol = DOCS_GALLERY / entry["id"] / "solfege.mp4"
    if entry["id"].startswith("omr") and docs_sol.exists():
        video_in = docs_sol
    else:
        video_in = find_solfege_video(video_job)

    out_mp4 = OUT_DIR / f"solfege-{entry['id']}-tangtang.mp4"
    remux_voice_only(vc_path, video_in, out_mp4)

    cello_src = find_cello_video(video_job if not entry["id"].startswith("omr") else job)
    # for omr keep existing cello from docs if any
    docs_cello = DOCS_GALLERY / entry["id"] / "cello.mp4"
    if entry["id"].startswith("omr") and docs_cello.exists():
        cello_src = docs_cello
    else:
        cello_src = find_cello_video(job)

    publish_entry(entry, out_mp4, cello_src)
    print(f"published gallery/{entry['id']}/ solfege+cello")
    return out_mp4


def main() -> None:
    ensure_ref()
    require_models()

    wanted = os.environ.get("SEEDVC_JOBS", "").strip()
    entries = GALLERY_JOBS
    if wanted:
        ids = {x.strip() for x in wanted.split(",") if x.strip()}
        entries = [e for e in entries if e["id"] in ids or e["job"] in ids]

    vc_cache: dict[str, Path] = {}
    # Process non-reuse first so omr can reuse
    primary = [e for e in entries if not e.get("reuse_vc_from")]
    secondary = [e for e in entries if e.get("reuse_vc_from")]
    done_meta = []
    for e in primary + secondary:
        process_one(e, vc_cache)
        done_meta.append(e)

    update_manifest(done_meta)
    print("\nALL DONE — sync docs ready. Push docs/ to deploy Pages.")


if __name__ == "__main__":
    main()
