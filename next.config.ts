import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit', 'fontkit', 'puppeteer'],
};

export default nextConfig;
