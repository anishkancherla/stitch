import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Syllabus PDFs (a few MB) are uploaded via server actions, so bump the
      // default 1MB cap. 25MB is well above any realistic syllabus.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
