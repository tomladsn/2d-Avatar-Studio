"""
Initialize a new avatar project from an uploaded image with a valid initial rig and built layers.
Usage: python tools/init_uploaded_project.py <source_image_path> <project_name>
"""
import sys
import os
import json
import math
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

def make_ellipse_polygon(cx, cy, rx, ry, count=16):
    pts = []
    for i in range(count):
        angle = (i / count) * math.pi * 2
        pts.push([round(cx + math.cos(angle) * rx), round(cy + math.sin(angle) * ry)])
    return pts

def init_project(source_path, name):
    source_path = Path(source_path).resolve()
    projects_dir = ROOT / "projects"
    project_dir = projects_dir / name
    
    with Image.open(source_path) as im:
        if im.format != "PNG":
            raise ValueError("source image must be a PNG")
        im = im.convert("RGBA")
        w, h = im.size
        # Ensure project dir
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "work").mkdir(parents=True, exist_ok=True)
        im.save(project_dir / "source.png")

    template_path = ROOT / "samples/miko-qipao/rig.json"
    template = json.loads(template_path.read_text(encoding="utf-8"))

    # Initial calibrated placements based on image dimensions
    # Standard portrait: head center at (0.5w, 0.28h), eyes at (0.43w, 0.25h) & (0.57w, 0.25h)
    eye0_cx, eye0_cy = round(w * 0.42), round(h * 0.25)
    eye1_cx, eye1_cy = round(w * 0.58), round(h * 0.25)
    eye_rx = max(round(w * 0.04), 18)
    eye_ry = max(round(h * 0.035), 14)
    
    # Generate 16-point polygons
    def ellipse_poly(cx, cy, rx, ry, n=16):
        return [[round(cx + math.cos(i * 2 * math.pi / n) * rx), 
                 round(cy + math.sin(i * 2 * math.pi / n) * ry)] for i in range(n)]

    mouth_cx = round(w * 0.5)
    mouth_cy = round(h * 0.38)
    mouth_half = max(round(w * 0.05), 24)

    rig = {
        "version": 1,
        "image": {"width": w, "height": h},
        "head": {
            "cx": round(w * 0.5),
            "cy": round(h * 0.26),
            "rx": round(w * 0.22),
            "ry": round(h * 0.26),
            "shiftX": round(w * 0.035),
            "shiftY": round(h * 0.02),
            "pivotX": round(w * 0.5),
            "pivotY": round(h * 0.48),
            "maxRoll": 0.15,
            "weightBand": [round(h * 0.44), round(h * 0.54)],
            "turnBand": [round(h * 0.45), round(h * 0.58)]
        },
        "body": {
            "pivotX": round(w * 0.5),
            "pivotY": round(h * 1.3),
            "maxRoll": 0.035,
            "breathBand": [round(h * 0.7), h],
            "rollBand": [round(h * 0.65), h],
            "chest": {
                "cx": round(w * 0.5),
                "cy": round(h * 0.75),
                "rx": round(w * 0.25),
                "ry": round(h * 0.2)
            },
            "shoulders": [
                {"cx": round(w * 0.28), "cy": round(h * 0.65), "rx": round(w * 0.15), "ry": round(h * 0.12)},
                {"cx": round(w * 0.72), "cy": round(h * 0.65), "rx": round(w * 0.15), "ry": round(h * 0.12)}
            ]
        },
        "face": {
            "nose": {"cx": round(w * 0.5), "cy": round(h * 0.32), "rx": round(w * 0.03), "ry": round(h * 0.03)},
            "mouth": {"cx": mouth_cx, "cy": mouth_cy, "rx": round(mouth_half * 1.2), "ry": round(h * 0.03)},
            "eyeA": {"cx": eye0_cx, "cy": eye0_cy, "rx": round(eye_rx * 1.2), "ry": round(eye_ry * 1.2)},
            "eyeB": {"cx": eye1_cx, "cy": eye1_cy, "rx": round(eye_rx * 1.2), "ry": round(eye_ry * 1.2)},
            "earL": {"cx": round(w * 0.35), "cy": round(h * 0.28), "rx": round(w * 0.03), "ry": round(h * 0.04)},
            "earR": {"cx": round(w * 0.65), "cy": round(h * 0.28), "rx": round(w * 0.03), "ry": round(h * 0.04)},
            "brow": {"cx": round(w * 0.5), "cy": round(h * 0.21), "rx": round(w * 0.1), "ry": round(h * 0.02), "band": [round(h * 0.22), round(h * 0.24)]},
            "jaw": {"cx": round(w * 0.5), "cy": round(h * 0.42), "rx": round(w * 0.08), "ry": round(h * 0.04), "band": [round(h * 0.38), round(h * 0.41)]}
        },
        "eyes": [
            {
                "opening": ellipse_poly(eye0_cx, eye0_cy, eye_rx, eye_ry, 16),
                "roi": ellipse_poly(eye0_cx, eye0_cy, round(eye_rx * 1.3), round(eye_ry * 1.3), 16)
            },
            {
                "opening": ellipse_poly(eye1_cx, eye1_cy, eye_rx, eye_ry, 16),
                "roi": ellipse_poly(eye1_cx, eye1_cy, round(eye_rx * 1.3), round(eye_ry * 1.3), 16)
            }
        ],
        "mouth": {
            "cx": mouth_cx,
            "cy": mouth_cy,
            "angle": 0.0,
            "halfLen": mouth_half,
            "bow": 2.0,
            "style": "natural",
            "area": {
                "cx": mouth_cx,
                "cy": mouth_cy,
                "rx": round(mouth_half * 1.2),
                "ry": round(h * 0.035),
                "angle": 0.0
            }
        },
        "cheeks": [[round(w * 0.42), round(h * 0.3)], [round(w * 0.58), round(h * 0.3)]],
        "mesh": {
            "baseCell": 14,
            "fine": {
                "x0": round(w * 0.28),
                "x1": round(w * 0.72),
                "y0": round(h * 0.05),
                "y1": round(h * 0.52),
                "cell": 7
            },
            "handCell": 9,
            "tasselCell": 6,
            "eyeBallCell": 4,
            "eyeCell": 3,
            "spriteCell": 4
        },
        "view": {
            "padTop": 0.0,
            "padSide": 0.0,
            "gazeCenter": [round(w * 0.5), round(h * 0.25)]
        }
    }

    draft_path = project_dir / "rig.draft.json"
    with open(draft_path, "w", encoding="utf-8") as f:
        json.dump(rig, f, indent=2)

    avatar_meta = {
        "name": name,
        "format": "mesh-avatar",
        "version": 1,
        "source": "source.png"
    }
    with open(project_dir / "avatar.json", "w", encoding="utf-8") as f:
        json.dump(avatar_meta, f, indent=2)

    print(f"Project initialized at {project_dir}")
    return 0

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: init_uploaded_project.py <source> <name>")
        sys.exit(1)
    sys.exit(init_project(sys.argv[1], sys.argv[2]))
