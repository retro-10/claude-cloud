/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" }, // CSV imports are posted as JSON rows
  },
  // We never use next/image. Turning the optimizer off also removes its /_next/image endpoint from the
  // attack surface (it has had serious advisories).
  images: { unoptimized: true },
};

export default nextConfig;
