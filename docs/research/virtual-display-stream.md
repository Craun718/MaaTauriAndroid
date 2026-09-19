# Virtual display streaming research

## Prototype status

The worktree prototype implements the WebCodecs branch: the existing virtual
display fans out to the unchanged Maa CPU copy and an EGL rendering into an
Android hardware H.264 encoder. A loopback WebSocket serves Annex B samples to
`VirtualDisplayCard`, which decodes them with WebCodecs and draws each output
frame to canvas. The old native overlay and bounds-reporting APIs are removed.

The prototype encodes at the virtual display's dimensions, 60 fps, CBR
8 Mbps, Main profile, and a one-second keyframe interval. It is ready for
on-device benchmarking; CI remains responsible for build and test verification.

## Current path

The Shizuku service creates a privileged `VirtualDisplay` and renders into a
`Surface` owned by the app process. That surface comes from an `AImageReader`
created by `control_bridge`/`virtual_display.cpp`.

Each available frame has two consumers:

1. `copy_hardware_frame()` maps the hardware buffer and copies RGBA pixels into
   CPU-owned buffers. Maa's Android native controller later reads these buffers
   through `GetLockedPixels()`.
2. `dispatch_preview()` sends the original hardware-backed image to an EGL render
   thread. That thread draws it into a native `SurfaceView` overlay above the
   WebView.

The overlay is not a `MediaProjection`; it is a native view. The frontend only
reports its measured bounds, and `MainActivity` positions the native view in
physical pixels.

At the default 1280x720 resolution, one RGBA frame is about 3.69 MB. At 60 fps,
the existing Maa screenshot copy alone moves about 221 MB/s through CPU-visible
memory. At 1080x1920 it is about 8.29 MB/frame, or about 498 MB/s at 60 fps.
This cost exists for recognition and must not be moved to the browser path.

## Recommended architecture

Keep the existing `AImageReader -> RGBA CPU buffer -> Maa` path unchanged. Do
not ask Maa to recognize from a decoded or lossy browser frame.

Add an independent preview path:

```text
VirtualDisplay
  -> AImageReader AHardwareBuffer
     -> CPU copy for Maa screenshots
     -> EGL draw into MediaCodec input Surface
        -> H.264 hardware encoder
        -> localhost binary transport
        -> WebView MSE <video> or WebCodecs <canvas>/<video>
```

The app process already owns the `AImageReader`. It can therefore own
`MediaCodec` too and pass the encoder input surface to the privileged service in
the same way it currently passes the reader surface. The privileged service does
not need to know about the encoder or transport.

### Encoder

Use Android `MediaCodec` with:

- MIME `video/avc`; H.264 has the best WebView compatibility.
- `COLOR_FormatSurface`, so pixels remain GPU-backed.
- Baseline or Main profile without B-frames for low latency.
- 30 fps for normal preview; 60 fps only when the game/UI benefits.
- 5-10 Mbps at 720p30, 8-20 Mbps at 720p60, and 12-30 Mbps at 1080p60.
- CBR plus the vendor/Android low-latency keys where available.
- Start/stop with WebView visibility and preview visibility. An idle virtual
  display used only by Maa should not encode.

The encoder can consume the same `AHardwareBuffer` through EGL after the CPU
copy. Preserve the source image until the EGL swap has completed and use its
timestamp as the encoder presentation time.

### Transport

Run a loopback-only WebSocket in the app process. Use a random bearer token,
reject non-local addresses, and close the server when the preview is disabled.
Do not expose the server through ADB port forwarding by default.

Send small binary messages containing a stream header, codec description, key
flags, timestamp, sequence number, and encoded sample. Keep only the latest
state for slow clients; do not build a large retransmission queue.

For rendering, prefer:

1. MSE feeding a normal `<video>` element when supported. This keeps presentation
   and compositing in WebView. Tune `SourceBuffer` appends aggressively; ordinary
   MSE buffering can easily add 100-300 ms.
2. WebCodecs `VideoDecoder` plus a desynchronized canvas as the lower-latency
   option. This gives frame-level control but adds JS and canvas scheduling.

Do not stream raw RGBA through Tauri IPC or localhost. At 720p60 that is about
221 MB/s and at 1080p60 about 498 MB/s before the browser bridge and JS bitmap
upload. It will saturate the bridge and cause UI jank.

## Options compared

| Option | Extra CPU | Expected quality/latency | Verdict |
| --- | ---: | --- | --- |
| Hardware H.264 + MSE/WebCodecs | Low | Good; 20-100 ms added preview latency | Recommended |
| Hardware H.265/AV1 | Low | Similar or lower bandwidth | Not first choice; compatibility varies |
| Software MJPEG/JPEG frames | Medium-high | 30-80 ms typical; 15-60+ Mbps | Useful debugging fallback |
| Software H.264/VP8 | High | 50-150 ms; likely dropped frames | Avoid for production |
| Raw RGBA/shared memory | Very high | Lowest processing but massive bandwidth | Avoid |

## Expected cost versus the native overlay

Numbers assume 720p60 on a mid-range ARM device and a healthy hardware encoder.
They are implementation targets for measurement, not guarantees.

- CPU: the current full-frame Maa copy remains, about 3.7 MB/frame. The stream
  transport adds little CPU, normally under 2% of one big core.
- GPU/codec: replacing the SurfaceView draw with an encoder-input draw is a
  similar full-screen texture sample. The hardware encoder/decoder pair adds
  roughly 0.3-1.5 W package power on mid-range silicon.
- Frame rate: flagship and healthy mid-range devices should sustain 60 fps.
  Target 30 fps on low-end devices or while a Maa run is active.
- Latency: the current native overlay is usually 10-25 ms beyond the virtual
  display. A tuned WebCodecs path adds about 25-60 ms; a tuned MSE path about
  50-120 ms; ordinary/buffered MSE can exceed 200 ms.
- Overall: with hardware encode, total power is usually 5-15% higher than the
  native overlay while the task is visible. Software encode or MJPEG can be
  several times worse and can interfere with the Maa task.

The dominant existing cost is not the native overlay itself; it is the CPU RGBA
copy retained for Maa recognition. The stream should therefore be treated as a
small additional GPU/codec load rather than a replacement for that copy.

## Integration touch points

- `MainActivity`: remove the `SurfaceView` overlay when streaming; render the
  stream inside `VirtualDisplayCard`.
- `virtual_display.cpp`: fan out each source image to CPU copy and encoder input
  surface; add encoder lifecycle and statistics.
- Rust/Tokio or Android service: loopback WebSocket server and codec-description
  handshake.
- Tauri IPC: expose a short-lived stream URL/token, preview state, fps, bitrate,
  encode/decode drops, and end-to-end sequence metadata.
- Frontend: feature-detect MSE/WebCodecs, render the stream in the existing
  preview box, show connection state, and stop it when the page is hidden.

## Benchmark plan

Run the same virtual display and Maa workload in four modes:

1. Native `SurfaceView` overlay.
2. Hardware H.264 stream, WebCodecs renderer.
3. Hardware H.264 stream, MSE renderer.
4. MJPEG fallback.

Record p50/p95/p99 of CPU copy duration, encoder input/output delay, transport
delay, decoder delay, browser queue delay, and visible-frame latency. Also record
fps drops, CPU/GPU frequency, per-thread CPU, WebView jank, battery rails, and
thermal state. Generate a test pattern with an embedded monotonic timestamp to
measure true glass-to-JS latency; a purely internal pipeline timestamp misses
WebView composition.

Accept a hardware H.264 implementation when 30 fps is stable on the target low
end, 60 fps is stable on the target mid-range, p95 preview latency stays within
120 ms for MSE or 80 ms for WebCodecs, and Maa recognition fps/accuracy are
unchanged.
