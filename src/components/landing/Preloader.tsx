import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

export function Preloader({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const num = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const counter = { v: 0 };
    const tl = gsap.timeline({ onComplete: onDone });
    tl.to(counter, {
      v: 100,
      duration: 1.6,
      ease: "power2.inOut",
      onUpdate: () => {
        if (num.current) num.current.textContent = String(Math.round(counter.v));
      },
    })
      .to(".preloader-word", { yPercent: -110, duration: 0.5, ease: "power3.in" }, "-=0.2")
      .to(".preloader-panel-top", { yPercent: -100, duration: 0.9, ease: "power4.inOut" })
      .to(".preloader-panel-bottom", { yPercent: 100, duration: 0.9, ease: "power4.inOut" }, "<")
      .set(root.current, { display: "none" });
    return () => {
      tl.kill();
    };
  }, [onDone]);

  return (
    <div ref={root} className="fixed inset-0 z-[100]">
      <div className="preloader-panel-top absolute inset-x-0 top-0 h-1/2 bg-[#08090c]" />
      <div className="preloader-panel-bottom absolute inset-x-0 bottom-0 h-1/2 bg-[#08090c]" />
      <div className="absolute inset-0 grid place-items-center overflow-hidden">
        <div className="overflow-hidden text-5xl" style={{ fontFamily: "Crimson Pro, serif" }}>
          <span className="preloader-word inline-block text-teal-300">
            Selah
            <span className="text-zinc-500 text-2xl align-super ml-3">
              <span ref={num}>0</span>%
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
