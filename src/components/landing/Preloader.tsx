import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap";

const SEEN_KEY = "selah-landing-intro-seen";

function shouldSkip(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A short brand reveal, once per visit. It used to count a made-up 0-100%
 * for nearly three seconds on every page view, with scrolling locked, and
 * the number had nothing to do with loading. Skipped for reduced motion and
 * after the first view in a session.
 */
export function Preloader({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [skip] = useState(shouldSkip);
  // Landing passes a fresh callback each render; holding it in a ref keeps the
  // reveal from restarting when the page re-renders after it finishes.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const onDone = () => done.current();
    if (skip) {
      onDone();
      return;
    }
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode: just show it */
    }
    const tl = gsap.timeline({ onComplete: onDone });
    tl.from(".preloader-word", { yPercent: 110, duration: 0.5, ease: "power3.out" })
      .to(".preloader-word", { yPercent: -110, duration: 0.4, ease: "power3.in" }, "+=0.2")
      .to(".preloader-panel-top", { yPercent: -100, duration: 0.7, ease: "power4.inOut" }, "-=0.1")
      .to(".preloader-panel-bottom", { yPercent: 100, duration: 0.7, ease: "power4.inOut" }, "<")
      .set(root.current, { display: "none" });
    return () => {
      tl.kill();
    };
  }, [skip]);

  if (skip) return null;

  return (
    <div ref={root} className="fixed inset-0 z-[100]" aria-hidden="true">
      <div className="preloader-panel-top absolute inset-x-0 top-0 h-1/2 bg-[#08090c]" />
      <div className="preloader-panel-bottom absolute inset-x-0 bottom-0 h-1/2 bg-[#08090c]" />
      <div className="absolute inset-0 grid place-items-center overflow-hidden">
        <div className="overflow-hidden text-5xl" style={{ fontFamily: "Crimson Pro, serif" }}>
          <span className="preloader-word inline-block text-teal-300">Selah</span>
        </div>
      </div>
    </div>
  );
}
