# Detector weights

`yolox_tiny.onnx` — the object detector used for interview proctoring
(`src/detector.ts`). It is the only thing that ever looks at a candidate's
camera, and it runs entirely inside this worker.

| | |
| --- | --- |
| **Model** | YOLOX-Tiny, COCO (80 classes) |
| **Source** | https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx |
| **Licence** | Apache-2.0 ([Megvii-BaseDetection/YOLOX](https://github.com/Megvii-BaseDetection/YOLOX)) |
| **Size** | 20,219,662 bytes |
| **SHA-256** | `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7` |
| **Input** | `images`, float32 `[1, 3, 416, 416]`, **BGR**, raw 0–255, no normalisation |
| **Output** | `output`, float32 `[1, 3549, 85]`, **undecoded** (see `decodeYoloxOutput`) |

## Why this model

**Licence first.** YOLOX is Apache-2.0. The better-known Ultralytics YOLO
family (v5/v8/v11) is **AGPL-3.0**, which attaches a source-disclosure
obligation to network use of the service it runs in — not something to take on
by accident for a detector that counts people. If you swap the weights, check
the licence before the benchmark.

Accuracy is more than sufficient for the job. The detector only needs to answer
"how many people, is there a phone" at webcam range, where subjects are large and
close. Its output is then filtered by the app's rule layer, which measures a run
from its first flagged sample to its last — so a marginal single-frame call spans
zero time, can never clear a threshold, and never reaches a recruiter.

## Why it is committed

`lk agent create` uploads this directory as-is, so a committed model means the
deploy is one hermetic artifact: no download at boot, no cold-start stall, no
dependency on a release URL still existing. 20MB is a one-time cost in the repo.

To use different weights without recommitting, set `VISION_MODEL_PATH` to an
absolute path. If the file is missing or won't load, the worker logs it once and
the interview runs with no camera evidence — proctoring never blocks a call.

## Verifying / replacing

```bash
curl -sSL -o models/yolox_tiny.onnx \
  https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx
sha256sum models/yolox_tiny.onnx   # must match the table above

# sanity-check the whole pipeline against an image
pnpm tsx scripts/detect.ts /path/to/a/webcam/screenshot.jpg
```

A different YOLOX size (`yolox_nano`, `yolox_s`) is a drop-in as long as it uses
the same 416×416 input and undecoded output head. A model from another family
almost certainly is **not** — preprocessing conventions differ (most YOLO exports
want normalised RGB, YOLOX wants raw BGR), and getting that wrong yields boxes
that look plausible and are quietly wrong. Re-run `scripts/detect.ts` against a
known image and check the boxes land on the objects before trusting it.
