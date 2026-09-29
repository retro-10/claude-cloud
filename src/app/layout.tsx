import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OrlaDent Camp CRM", template: "%s · OrlaDent Camp CRM" },
  robots: { index: false, follow: false }, // an internal tool: never indexed
};

// Inter and Playfair Display come from Google Fonts. The stylesheet is loaded without blocking the first
// paint (media="print" then switched on load) and uses font-display: swap, so text shows at once in the
// system font and switches when the fonts arrive. If they never arrive (offline, blocked) nothing breaks.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@600&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} media="print" id="fonts-css" />
        <script dangerouslySetInnerHTML={{ __html: "document.getElementById('fonts-css').onload=function(){this.media='all'}" }} />
        <noscript>
          <link rel="stylesheet" href={FONTS} />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
