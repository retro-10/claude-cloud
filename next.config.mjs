/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ["postgres", "bcryptjs"],
    serverActions: { bodySizeLimit: "10mb" }, // CSV imports are posted as JSON rows
  },
};

export default nextConfig;
