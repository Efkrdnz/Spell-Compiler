import { ctx2d, lightSprite, makeCanvas, type Canvas } from './sprites';

/**
 * Light buffer: an ambient-darkness canvas (half resolution) onto which
 * coloured lights are added. Multiplying it over the scene gives dynamic
 * lighting; very bright lights also wash a little colour in on top.
 */
export class Lighting {
  canvas: Canvas = makeCanvas(1, 1);
  private g = ctx2d(this.canvas);
  private cap = 120;
  private n = 0;
  private lx = new Float32Array(this.cap);
  private ly = new Float32Array(this.cap);
  private lr = new Float32Array(this.cap);
  private li = new Float32Array(this.cap);
  private lc: string[] = new Array(this.cap);
  ambient = '#857ea6';
  res = 0.5;

  resize(w: number, h: number): void {
    const cw = Math.max(1, Math.round(w * this.res));
    const ch = Math.max(1, Math.round(h * this.res));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
  }

  begin(): void {
    this.n = 0;
  }

  /** add a light in world coordinates */
  add(x: number, y: number, r: number, color: string, intensity: number): void {
    if (this.n >= this.cap || intensity <= 0.01 || r <= 1) return;
    const i = this.n++;
    this.lx[i] = x;
    this.ly[i] = y;
    this.lr[i] = r;
    this.li[i] = intensity;
    this.lc[i] = color;
  }

  get count(): number {
    return this.n;
  }

  /** Multiply the light buffer over the target (whose transform is identity in device px). */
  composite(target: CanvasRenderingContext2D, S: number, ox: number, oy: number, w: number, h: number): void {
    const g = this.g;
    const k = this.res;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = this.ambient;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(S * k, 0, 0, S * k, ox * k, oy * k);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      const r = this.lr[i];
      g.globalAlpha = Math.min(1, this.li[i]);
      g.drawImage(lightSprite(this.lc[i]), this.lx[i] - r, this.ly[i] - r, r * 2, r * 2);
      // over-bright lights stack a second time
      if (this.li[i] > 1) {
        g.globalAlpha = Math.min(1, this.li[i] - 1);
        g.drawImage(lightSprite(this.lc[i]), this.lx[i] - r * 0.6, this.ly[i] - r * 0.6, r * 1.2, r * 1.2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = 'multiply';
    target.imageSmoothingEnabled = true;
    target.drawImage(this.canvas, 0, 0, w, h);
    target.restore();
  }
}
