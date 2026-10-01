export default { async rewrites() { return [{ source: "/api/:path*", destination: "http://localhost:4100/api/:path*" }]; } };
