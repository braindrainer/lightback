/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  poweredByHeader: false,
};

export default config;
