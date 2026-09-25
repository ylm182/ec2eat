import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "ec2eat--ec2eat-davidyu-prod.asia-east1.hosted.app" }],
      destination: "https://ec2eat.fun/:path*",
      permanent: true,
    }];
  },
};
export default config;
