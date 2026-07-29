import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";

const TRANSCRIPT =
  "...and this is the heart of the gospel, church. For God so loved the world — turn with me to John 3:16 — that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.";

export function SermonListener() {
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const words = gsap.utils.toArray<HTMLElement>(".tw");
      const detectIdx = words.findIndex((w) => w.dataset.detect === "true");

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: "+=300%",
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
        },
      });

      tl.from(".sl-copy", { x: -60, opacity: 0, duration: 0.5 })
        .from(".sl-panel", { x: 60, opacity: 0, duration: 0.5 }, "<")
        .to(words, { opacity: 1, y: 0, stagger: 0.06, duration: 0.1 });

      if (detectIdx >= 0) {
        tl.to(
          words[detectIdx],
          {
            color: "#5eead4",
            textShadow: "0 0 24px rgba(20,184,166,0.8)",
            duration: 0.2,
          },
          `>-${(words.length - detectIdx) * 0.06}`
        );
      }

      tl.from(".sl-detect-card", { scale: 0.85, opacity: 0, y: 20, duration: 0.3, ease: "back.out(2)" })
        .from(".sl-projection", { clipPath: "inset(0 100% 0 0)", duration: 0.5, ease: "power3.inOut" })
        .from(".sl-verse-text", { opacity: 0, y: 12, duration: 0.3 });

      const bars = gsap.utils.toArray<HTMLElement>(".sl-bar");
      const dance = gsap.to(bars, {
        scaleY: () => gsap.utils.random(0.2, 1),
        duration: 0.18,
        repeat: -1,
        repeatRefresh: true,
        ease: "sine.inOut",
        stagger: { each: 0.02, repeat: -1 },
        paused: true,
      });
      ScrollTrigger.create({
        trigger: section.current,
        start: "top top",
        end: "+=300%",
        onToggle: (self) => (self.isActive ? dance.play() : dance.pause()),
      });
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={section} id="sermon-listener" className="relative min-h-screen flex items-center px-6">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 items-center">
        <div className="sl-copy">
          <p className="text-sm uppercase tracking-[0.3em] text-teal-400">AI Sermon Listener</p>
          <h2 className="mt-4 text-4xl sm:text-5xl text-white" style={{ fontFamily: "Crimson Pro, serif" }}>
            Keep scrolling.
            <br />
            You're preaching.
          </h2>
          <p className="mt-6 text-zinc-400 max-w-md">
            Your scroll wheel is the sermon. Watch Selah transcribe it, follow the context, and find the
            verse — offline, as it's spoken.
          </p>
        </div>

        <div className="sl-panel rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 backdrop-blur">
          <div className="flex h-12 items-center gap-[3px]">
            {Array.from({ length: 48 }).map((_, i) => (
              <span key={i} className="sl-bar h-full w-1 origin-center rounded-full bg-teal-500/70" />
            ))}
          </div>

          <p className="mt-6 min-h-[7rem] text-sm leading-7 text-zinc-300" style={{ fontFamily: "monospace" }}>
            {TRANSCRIPT.split(" ").map((w, i) => (
              <span
                key={i}
                data-detect={w.includes("3:16") || w === "John" ? "true" : undefined}
                className="tw mr-[0.35em] inline-block translate-y-2 opacity-0"
              >
                {w}
              </span>
            ))}
          </p>

          <div className="sl-detect-card mt-4 flex items-center gap-3 rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-teal-400" />
            <span className="text-sm text-teal-200">John 3:16 detected — sending to screen</span>
          </div>

          <div className="sl-projection mt-4 rounded-xl bg-black p-6 ring-1 ring-zinc-800">
            <p className="sl-verse-text text-lg text-white" style={{ fontFamily: "Crimson Pro, serif" }}>
              "For God so loved the world that he gave his one and only Son…"
            </p>
            <p className="mt-2 text-xs text-zinc-500">JOHN 3:16 · NIV</p>
          </div>
        </div>
      </div>
    </section>
  );
}
