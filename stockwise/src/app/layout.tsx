import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BeanCounter",
  description: "An autonomous restocking agent for Bean & Leaf Coffee that buys within the owner's written policy.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${unbounded.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="backdrop" aria-hidden />
        {children}
      </body>
    </html>
  );
}
