import { X } from "lucide-react";
import { Modal } from "@/components/modals/Modal";

/**
 * The "Watch it work" demo: one Sunday service in Selah, silent, 1:24.
 * Muted so it can start on open (browsers block unmuted autoplay); the
 * controls are there to pause or unmute. The file loads only when opened.
 */
export function DemoVideoModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Selah demo video"
      zIndexClassName="z-[100]"
      overlayClassName="bg-black/85 backdrop-blur-sm"
      className="relative w-full max-w-6xl"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close video"
        className="absolute -top-12 right-0 rounded-full p-2 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X className="w-6 h-6" />
      </button>
      <div className="overflow-hidden rounded-2xl ring-1 ring-white/10 bg-black shadow-[0_40px_120px_-30px_rgba(20,184,166,0.35)]">
        <video
          className="block w-full aspect-video"
          src="/selah-demo.mp4"
          poster="/selah-demo-poster.jpg"
          autoPlay
          muted
          controls
          playsInline
          preload="none"
          aria-label="Selah demo: a Sunday service with the countdown, hymn lyrics, the pastor's spoken verse caught and put on screen, and a volunteer helping from a phone"
        />
      </div>
    </Modal>
  );
}
