// Polyfill DOMMatrix for Node.js compatibility with pdfjs-dist
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (typeof init === "string") {
        // Parse transform string - basic implementation
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      } else if (Array.isArray(init)) {
        // From array [a, b, c, d, e, f]
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init && typeof init === "object") {
        // From object
        this.a = init.a || 1;
        this.b = init.b || 0;
        this.c = init.c || 0;
        this.d = init.d || 1;
        this.e = init.e || 0;
        this.f = init.f || 0;
      } else {
        // Identity matrix
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }

    static fromMatrix(other) {
      return new DOMMatrix([other.a, other.b, other.c, other.d, other.e, other.f]);
    }

    multiply(other) {
      const a = this.a * other.a + this.b * other.c;
      const b = this.a * other.b + this.b * other.d;
      const c = this.c * other.a + this.d * other.c;
      const d = this.c * other.b + this.d * other.d;
      const e = this.e * other.a + this.f * other.c + other.e;
      const f = this.e * other.b + this.f * other.d + other.f;
      return new DOMMatrix([a, b, c, d, e, f]);
    }

    translate(tx, ty) {
      return new DOMMatrix([
        this.a,
        this.b,
        this.c,
        this.d,
        this.e + tx * this.a + ty * this.c,
        this.f + tx * this.b + ty * this.d,
      ]);
    }

    scale(sx, sy = sx) {
      return new DOMMatrix([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f]);
    }

    inverse() {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) throw new Error("Matrix is not invertible");
      return new DOMMatrix([
        this.d / det,
        -this.b / det,
        -this.c / det,
        this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det,
      ]);
    }
  };
}

// Polyfill Canvas for Node.js compatibility with pdfjs-dist
if (typeof globalThis.OffscreenCanvas === "undefined") {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext(contextType) {
      if (contextType === "2d") {
        return {
          fillRect: () => {},
          clearRect: () => {},
          getImageData: (x, y, w, h) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
          putImageData: () => {},
          createImageData: (w, h) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
          setTransform: () => {},
          drawImage: () => {},
          save: () => {},
          fillText: () => {},
          restore: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          closePath: () => {},
          stroke: () => {},
          fill: () => {},
          measureText: () => ({ width: 0 }),
          isPointInPath: () => false,
        };
      }
      return null;
    }

    convertToBlob() {
      return Promise.resolve(new Blob());
    }
  };
}

if (typeof globalThis.HTMLCanvasElement === "undefined") {
  globalThis.HTMLCanvasElement = class HTMLCanvasElement {
    constructor() {
      this.width = 0;
      this.height = 0;
    }

    getContext(contextType) {
      return new globalThis.OffscreenCanvas(this.width, this.height).getContext(contextType);
    }

    toDataURL() {
      return "data:image/png;base64,";
    }

    toBlob(callback) {
      callback(new Blob());
    }
  };
}
