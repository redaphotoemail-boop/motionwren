import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // vinext screens every multipart/form-data POST as a possible server
      // action before routing, and rejects it with 413 "Payload Too Large"
      // above this limit (1 MB by default). That blocked every listing photo
      // over 1 MB from reaching /api/projects/[id]/assets. The upload route
      // enforces its own 20 MB per-photo cap, so allow that plus form overhead.
      bodySizeLimit: "21mb",
    },
  },
};

export default nextConfig;
