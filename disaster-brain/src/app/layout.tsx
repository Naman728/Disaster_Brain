import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { PatientProvider } from "@/context/PatientContext";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Disaster Brain — Offline Triage AI",
  description:
    "AI-powered disaster triage for first responders. Works fully offline.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950`}>
        <PatientProvider>{children}</PatientProvider>
      </body>
    </html>
  );
}
