import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../game/game.css";

export const metadata: Metadata = {
  title: "CHEESE // No Safe Corners",
  description: "A fast, first-person survival maze. Find the cheese. Fear what learns."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ margin: 0, padding: 0, background: "#0d100e" }}>{children}</body></html>;
}
