export interface ImageInfo {
  mime: string;
  width: number;
  height: number;
}

// Read real mime + dimensions from image bytes (PNG/JPEG/WebP/GIF/SVG).
// Returns null for unsupported formats (e.g. PDF) instead of inventing sizes.
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mime: "image/png", width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mime: "image/gif", width: v.getUint16(6, true), height: v.getUint16(8, true) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      const len = (bytes[off + 2] << 8) + bytes[off + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { mime: "image/jpeg", height: (bytes[off + 5] << 8) + bytes[off + 6], width: (bytes[off + 7] << 8) + bytes[off + 8] };
      }
      if (len < 2) break;
      off += 2 + len;
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + v.getUint32(24, true) % 0x1000000, height: 1 + (v.getUint32(27, true) >> 8) };
    return { mime: "image/webp", width: 0, height: 0 };
  }
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    const text = new TextDecoder().decode(bytes.slice(0, 4096));
    const vb = text.match(/viewBox\s*=\s*"([\d.\s-]+)"/);
    if (vb) {
      const p = vb[1].trim().split(/\s+/).map(Number);
      if (p.length === 4) return { mime: "image/svg+xml", width: Math.round(p[2]), height: Math.round(p[3]) };
    }
    const w = text.match(/<svg[^>]*\bwidth\s*=\s*"(\d+)/);
    const h = text.match(/<svg[^>]*\bheight\s*=\s*"(\d+)/);
    if (w && h) return { mime: "image/svg+xml", width: Number(w[1]), height: Number(h[1]) };
    return { mime: "image/svg+xml", width: 0, height: 0 };
  }
  return null;
}
