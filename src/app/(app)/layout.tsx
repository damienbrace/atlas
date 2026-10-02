import type { ReactNode } from "react";
import { VoiceCaptureProvider } from "@/components/capture/voice-capture";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <VoiceCaptureProvider>
        <div className="flex h-dvh">
          <Sidebar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
        <MobileNav />
      </VoiceCaptureProvider>
    </ToastProvider>
  );
}
