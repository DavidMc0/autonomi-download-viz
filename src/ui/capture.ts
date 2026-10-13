// In-page capture: record the stage's canvas to WebM with captureStream() + MediaRecorder.
// DOM/SVG skins have no canvas to capture; use `npm run capture` (Playwright video) for those.

export class CanvasRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.rec !== null;
  }

  start(stage: HTMLElement): string | null {
    const canvas = stage.querySelector("canvas");
    if (!canvas) return "This skin has no canvas to record. Use npm run capture instead.";
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return "This browser can't record WebM.";
    this.chunks = [];
    this.rec = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    return null;
  }

  stop(filename: string): Promise<void> {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return Promise.resolve();
    return new Promise((resolve) => {
      rec.onstop = () => {
        const url = URL.createObjectURL(new Blob(this.chunks, { type: "video/webm" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve();
      };
      rec.stop();
    });
  }
}
