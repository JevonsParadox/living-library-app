"use client";

import { useState, useRef, useCallback } from "react";
import { Camera, Video, Square, X } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (images: Blob[]) => void;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const [mode, setMode] = useState<"choose" | "recording" | "processing">("choose");
  const [recordingTime, setRecordingTime] = useState(0);
  const [processProgress, setProcessProgress] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Photo capture ---

  const handlePhoto = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      onCapture([file]);
    },
    [onCapture]
  );

  // --- Video capture ---

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        stopStream();
        extractFrames(blob);
      };

      recorder.start();
      setMode("recording");
      setRecordingTime(0);

      // Timer + auto-stop at 30s
      timerRef.current = setInterval(() => {
        setRecordingTime((t) => {
          if (t >= 29) {
            stopRecording();
            return 30;
          }
          return t + 1;
        });
      }, 1000);
    } catch {
      alert("Camera access denied. Please allow camera permissions.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.stop();
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // --- Frame extraction ---

  const extractFrames = useCallback(
    async (videoBlob: Blob) => {
      setMode("processing");
      setProcessProgress("Loading video...");

      const url = URL.createObjectURL(videoBlob);
      const video = document.createElement("video");
      video.muted = true;
      video.src = url;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.load();
      });

      const duration = video.duration;
      const interval = 1.5;
      const frameCount = Math.min(Math.floor(duration / interval), 20);
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d")!;
      const frames: Blob[] = [];
      let prevData: ImageData | null = null;

      for (let i = 0; i < frameCount; i++) {
        const t = i * interval;
        setProcessProgress(`Extracting frame ${i + 1} of ${frameCount}...`);

        // Seek to time
        video.currentTime = t;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Simple duplicate detection: compare with previous frame
        const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (prevData) {
          const diff = pixelDiff(prevData.data, currentData.data);
          if (diff < 0.03) {
            // Skip very similar frame
            continue;
          }
        }
        prevData = currentData;

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
        });
        if (blob) frames.push(blob);
      }

      URL.revokeObjectURL(url);
      setProcessProgress(`Extracted ${frames.length} unique frames`);

      // Short delay so user sees the count
      await new Promise((r) => setTimeout(r, 500));
      onCapture(frames);
    },
    [onCapture]
  );

  return (
    <div className="space-y-3">
      {/* Close button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-foreground font-medium">Add books from shelf</p>
        <button onClick={onCancel} className="text-muted hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      {mode === "choose" && (
        <div className="space-y-2">
          {/* Photo option */}
          <label className="flex items-center gap-2 w-full p-2.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors cursor-pointer">
            <Camera size={14} className="text-accent" />
            <div>
              <p className="text-xs text-foreground">Take a photo</p>
              <p className="text-[10px] text-muted">Best for a single shelf section</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              className="hidden"
            />
          </label>

          {/* Video option */}
          <button
            onClick={startRecording}
            className="flex items-center gap-2 w-full p-2.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors text-left"
          >
            <Video size={14} className="text-accent" />
            <div>
              <p className="text-xs text-foreground">Record video</p>
              <p className="text-[10px] text-muted">Pan along your shelf (up to 30s)</p>
            </div>
          </button>
        </div>
      )}

      {mode === "recording" && (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {/* Recording indicator */}
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 rounded-full px-2 py-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] text-white font-mono">{recordingTime}s / 30s</span>
            </div>
          </div>
          <button
            onClick={stopRecording}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 transition-colors"
          >
            <Square size={12} />
            Stop recording
          </button>
        </div>
      )}

      {mode === "processing" && (
        <div className="flex flex-col items-center justify-center py-6 space-y-2">
          <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <p className="text-[10px] text-muted">{processProgress}</p>
        </div>
      )}
    </div>
  );
}

// --- Utility ---

function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  // Sample every 100th pixel for speed
  let diff = 0;
  let samples = 0;
  for (let i = 0; i < a.length; i += 400) {
    diff += Math.abs(a[i] - b[i]) / 255;
    samples++;
  }
  return samples > 0 ? diff / samples : 0;
}
