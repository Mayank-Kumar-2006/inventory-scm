import "./globals.css";
export const metadata = { title: "Stockroom: inventory & supply chain" };
export default function RootLayout({ children }) {
  return (<html lang="en"><head>
    <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&display=swap" rel="stylesheet" />
  </head><body>{children}</body></html>);
}
