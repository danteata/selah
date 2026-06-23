import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

const ACCENT = {
  teal: { card: "hover:border-teal-500/50", icon: "bg-teal-500/15 ring-1 ring-teal-500/30" },
  amber: { card: "hover:border-amber-500/50", icon: "bg-amber-500/15 ring-1 ring-amber-500/30" },
  rose: { card: "hover:border-rose-500/50", icon: "bg-rose-500/15 ring-1 ring-rose-500/30" },
  indigo: { card: "hover:border-indigo-500/50", icon: "bg-indigo-500/15 ring-1 ring-indigo-500/30" },
} as const;

const FEATURES = [
  { title: "Song & Hymn Library", tag: "Core", accent: "teal" as const, y: "lg:mt-0" },
  { title: "Bible on Screen", tag: "Core", accent: "amber" as const, y: "lg:mt-16" },
  { title: "Media & Video", tag: "Core", accent: "rose" as const, y: "lg:mt-4" },
  { title: "Countdown Timers", tag: "Live", accent: "indigo" as const, y: "lg:mt-20" },
  { title: "Live Announcements", tag: "Live", accent: "teal" as const, y: "lg:mt-8" },
  { title: "Projection Output", tag: "Core", accent: "amber" as const, y: "lg:mt-12" },
];

const ICONS: Record<string, string> = {
  "Song & Hymn Library": "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z",
  "Bible on Screen": "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  "Media & Video": "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
  "Countdown Timers": "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  "Live Announcements": "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
  "Projection Output": "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
};

export function FeaturesRail() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px)", () => {
      const getX = () => -(track.current!.scrollWidth - window.innerWidth);
      const tween = gsap.to(track.current, {
        x: getX,
        ease: "none",
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: () => `+=${-getX()}`,
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });
      gsap.utils.toArray<HTMLElement>(".feat-icon").forEach((icon) => {
        gsap.to(icon, {
          x: -40,
          ease: "none",
          scrollTrigger: { containerAnimation: tween, trigger: icon, scrub: true },
        });
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={section} id="features" className="relative overflow-hidden">
      <div
        ref={track}
        className="flex flex-col gap-6 px-6 py-24 lg:h-screen lg:flex-row lg:items-center lg:gap-10 lg:px-[12vw] lg:py-0"
      >
        <div className="lg:min-w-[28vw]">
          <h2 className="text-4xl sm:text-5xl text-white" style={{ fontFamily: "Crimson Pro, serif" }}>
            Everything Sunday needs.
          </h2>
          <p className="mt-4 text-zinc-400">One tool, zero tab-switching.</p>
        </div>
        {FEATURES.map((f) => (
          <article
            key={f.title}
            data-cursor="Drag"
            className={`group rounded-3xl border border-zinc-800 bg-zinc-950/60 p-8 transition-colors ${ACCENT[f.accent].card} lg:min-w-[24rem] ${f.y}`}
          >
            <div className={`feat-icon h-12 w-12 rounded-xl ${ACCENT[f.accent].icon}`}>
              <svg className="h-6 w-6 text-white/70 m-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[f.title] ?? ""} />
              </svg>
            </div>
            <span className="mt-6 inline-block text-xs uppercase tracking-widest text-zinc-500">{f.tag}</span>
            <h3 className="mt-2 text-2xl text-white" style={{ fontFamily: "Crimson Pro, serif" }}>
              {f.title}
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}
