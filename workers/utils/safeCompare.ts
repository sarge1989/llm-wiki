/**
 * Constant-time equality helpers. Used wherever a comparison failure should
 * not leak timing information about the secret being compared.
 *
 * Workers ship `crypto.subtle.timingSafeEqual` as a non-standard extension on
 * some configurations, but it isn't reliably typed across runtimes. A manual
 * XOR-and-OR loop is portable, ~5 lines, and just as safe — JS bitwise ops
 * don't short-circuit, so the loop runs in fixed time for equal-length inputs.
 *
 * Length differences are not protected (early return) — same as every other
 * standard library implementation. Length is rarely the secret.
 */

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function constantTimeBytesEqual(
  a: Uint8Array,
  b: Uint8Array,
): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
