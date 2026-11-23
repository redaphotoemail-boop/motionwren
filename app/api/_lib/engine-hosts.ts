/* Where a finished video may be fetched from. Replicate's own delivery domain, plus the engines that host their own output
   (Vidu returns its video from video.cf.vidu.com instead of replicate.delivery). Always https. */
export function isEngineVideoHost(hostname: string) {
  return hostname === "replicate.delivery" || hostname.endsWith(".replicate.delivery") || hostname === "vidu.com" || hostname.endsWith(".vidu.com");
}
