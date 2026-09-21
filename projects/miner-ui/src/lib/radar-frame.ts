export function radarAllowsIframe(xFrameOptions: string | null, csp: string | null): boolean {
  if (xFrameOptions && xFrameOptions.trim()) {
    return false;
  }
  if (csp && /frame-ancestors/i.test(csp)) {
    return false;
  }
  return true;
}
