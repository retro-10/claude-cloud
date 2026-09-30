import type { Metadata, Viewport } from "next";
import { THEME_BOOT } from "@/components/shell/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OrlaDent Camp CRM", template: "%s · OrlaDent Camp CRM" },
  robots: { index: false, follow: false }, // an internal tool: never indexed
};

export const viewport: Viewport = {
  themeColor: "#0B0B10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Archivo (body) and Bodoni Moda (headlines), the Camp typefaces, come from Google Fonts. The stylesheet is loaded without blocking the first
// paint (media="print" then switched on load) and uses font-display: swap, so text shows at once in the
// system font and switches when the fonts arrive. If they never arrive (offline, blocked) nothing breaks.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600;6..96,700&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* before first paint: apply the saved theme so there is no flash of the wrong one */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
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
