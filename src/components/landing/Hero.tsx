import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { gsap } from "@/lib/gsap";
import { WelcomeScene } from "@/components/landing/WelcomeScene";
import { Magnetic } from "@/components/landing/Magnetic";

function splitChars(el: HTMLElement) {
  const text = el.textContent ?? "";
  el.setAttribute("aria-label", text);
  el.innerHTML = text
    .split("")
    .map(
      (c) =>
        `<span class="hero-char inline-block will-change-transform" aria-hidden="true">${c === " " ? "&nbsp;" : c}</span>`
    )
    .join("");
}

export function Hero({ started }: { started: boolean }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!started || !h1.current) return;
    h1.current.querySelectorAll(".hero-line").forEach((line) => splitChars(line as HTMLElement));

    const tl = gsap.timeline();
    tl.from(".hero-char", {
      yPercent: 120,
      rotateX: -80,
      opacity: 0,
      duration: 1,
      ease: "power4.out",
      stagger: { each: 0.025, from: "start" },
    })
      .from(".hero-eyebrow", { y: 16, opacity: 0, duration: 0.6, ease: "power3" }, "-=0.7")
      .from(".hero-sub", { y: 24, opacity: 0, duration: 0.8, ease: "power3" }, "-=0.5")
      .from(".hero-cta", { y: 20, opacity: 0, stagger: 0.1, duration: 0.6 }, "-=0.5")
      .from(".hero-stat", { y: 16, opacity: 0, stagger: 0.07, duration: 0.5 }, "-=0.4")
      .from(".hero-mockup", { y: 40, opacity: 0, duration: 1, ease: "power3.out" }, "-=0.6");

    const chars = gsap.utils.toArray<HTMLElement>(".hero-char");
    const onMove = (e: PointerEvent) => {
      chars.forEach((c) => {
        const r = c.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < 160) {
          const f = (1 - dist / 160) * 14;
          gsap.to(c, { x: (-dx / dist) * f, y: (-dy / dist) * f, duration: 0.4 });
        } else {
          gsap.to(c, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.5)" });
        }
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      tl.kill();
      window.removeEventListener("pointermove", onMove);
    };
  }, [started]);

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden px-6 pt-24 pb-12">
      <WelcomeScene />

      <div className="relative z-10 max-w-6xl mx-auto text-center" style={{ perspective: "800px" }}>
        <div className="hero-eyebrow inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-7 text-[10px] font-bold uppercase tracking-[0.22em]" style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(13,148,136,0.05) 100%)', border: '1px solid rgba(20,184,166,0.35)', color: '#5eead4' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
          Now in open beta · v2 ships this month
        </div>

        <h1 ref={h1} className="text-5xl sm:text-7xl lg:text-[5.5rem] text-white leading-[1.02] tracking-tight" style={{ fontFamily: "Crimson Pro, serif", fontWeight: 600 }}>
          <span className="hero-line block">Preach the sermon.</span>
          <span className="hero-line block">
            <span className="italic" style={{ background: 'linear-gradient(135deg, #5eead4 0%, #fcd34d 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>We&rsquo;ll find the verse.</span>
          </span>
        </h1>

        <p className="hero-sub mt-7 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Selah listens to your sermon, catches every scripture reference, and puts the right verse on screen &mdash; <span className="text-zinc-200">automatically, offline, in real time.</span>
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-4">
          <Magnetic>
            <Link
              to="/signup"
              data-cursor="Go"
              className="hero-cta group inline-flex items-center gap-2 rounded-full px-8 py-4 font-semibold text-[#08090c] transition-all"
              style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)', boxShadow: '0 8px 32px -4px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.2)' }}
            >
              <span>Get My Church Started</span>
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <a
              href="#sermon-listener"
              data-cursor="Watch"
              className="hero-cta inline-flex items-center gap-2 rounded-full border border-zinc-700/80 px-7 py-4 text-zinc-200 hover:border-teal-500/60 hover:text-white transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              <span>Watch it work</span>
              <span className="text-zinc-500">90s</span>
            </a>
          </Magnetic>
        </div>

        <div className="mt-7 flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-[13px] text-zinc-500">
          {[
            { label: 'Free during beta', check: true },
            { label: 'No credit card', check: true },
            { label: 'Works fully offline', check: true },
            { label: 'Under 30-min setup', check: true },
          ].map((s) => (
            <span key={s.label} className="hero-stat inline-flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-primary-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Floating product mockup — the actual app surface */}
      <div ref={mockupRef} className="hero-mockup relative z-10 mt-16 max-w-4xl mx-auto">
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, rgba(15,18,22,0.95) 0%, rgba(8,10,14,0.98) 100%)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 60px 120px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {/* App chrome */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
            </div>
            <div className="ml-3 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em]" style={{ color: 'rgba(255,255,255,0.45)' }}>
              <BookOpen className="w-3 h-3" /> selah.app
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · Sunday 10:42 AM
            </div>
          </div>

          {/* App body */}
          <div className="grid grid-cols-[180px_1fr_220px] min-h-[280px]">
            {/* Left rail — service order */}
            <div className="p-3 border-r" style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
              <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/40 mb-2.5 px-1">Service order</div>
              {[
                { label: 'Welcome', done: true },
                { label: 'Worship · 3 songs', done: true },
                { label: 'Sermon', active: true },
                { label: 'Offering', done: false },
                { label: 'Communion', done: false },
                { label: 'Closing', done: false },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md mb-0.5 text-[11px]"
                  style={
                    item.active
                      ? { background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)', color: '#5eead4' }
                      : { color: item.done ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.6)' }
                  }
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      background: item.active ? '#5eead4' : item.done ? 'rgba(20,184,166,0.4)' : 'rgba(255,255,255,0.2)',
                      boxShadow: item.active ? '0 0 8px #5eead4' : 'none',
                    }}
                  />
                  <span className={item.done ? 'line-through decoration-white/20' : ''}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Center — projection preview */}
            <div className="p-4 flex flex-col">
              <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/40 mb-2">On screen now</div>
              <div
                className="flex-1 rounded-lg flex flex-col items-center justify-center text-center px-4 relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #042f2e 0%, #0c0a09 100%)' }}
              >
                <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(circle at 30% 30%, rgba(20,184,166,0.3), transparent 60%)' }} />
                <div className="relative">
                  <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-teal-300/80 mb-2">John 3:16</div>
                  <div className="text-white text-base sm:text-lg leading-snug" style={{ fontFamily: 'Crimson Pro, serif' }}>
                    &ldquo;For God so loved the world<br/>that he gave his one and only Son…&rdquo;
                  </div>
                  <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 mt-3">NIV · Pushed 2s ago</div>
                </div>
              </div>
            </div>

            {/* Right — AI listener status */}
            <div className="p-3 border-l" style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
              <div className="flex items-center justify-between mb-2.5 px-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/40">AI Listener</div>
                <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.22em] text-emerald-400">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                  Live
                </div>
              </div>
              <div className="flex items-end gap-[2px] h-7 mb-3">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full"
                    style={{
                      background: 'linear-gradient(180deg, #5eead4 0%, #0d9488 100%)',
                      height: `${30 + Math.abs(Math.sin(i * 0.6)) * 70}%`,
                      animation: `waveform-bar 1.1s ease-in-out ${i * 0.04}s infinite`,
                      opacity: 0.75,
                    }}
                  />
                ))}
              </div>
              <div className="rounded-md p-2 mb-2" style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.25)' }}>
                <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-teal-300 mb-0.5">Just detected</div>
                <div className="text-[11px] text-white font-medium">John 3:16</div>
              </div>
              <div className="rounded-md p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-0.5">Queue</div>
                <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>Romans 6:23 · Romans 5:8</div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating annotation chips around the mockup */}
        <div
          className="hidden lg:flex absolute -left-6 top-1/4 items-center gap-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap"
          style={{ background: 'rgba(15,18,22,0.95)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>Caught it the moment you said it</span>
        </div>
        <div
          className="hidden lg:flex absolute -right-6 bottom-12 items-center gap-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap"
          style={{ background: 'rgba(15,18,22,0.95)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)' }}
        >
          <svg className="w-3.5 h-3.5 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>Pushed to every screen instantly</span>
        </div>
      </div>
    </section>
  );
}
