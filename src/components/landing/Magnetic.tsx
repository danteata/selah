import { useRef, type ReactNode } from "react";
import { gsap } from "@/lib/gsap";

export function Magnetic({ children, strength = 0.35 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    gsap.to(el, {
      x: (e.clientX - r.left - r.width / 2) * strength,
      y: (e.clientY - r.top - r.height / 2) * strength,
      duration: 0.4,
      ease: "power3",
    });
    gsap.to(el.firstElementChild, {
      x: (e.clientX - r.left - r.width / 2) * strength * 0.4,
      y: (e.clientY - r.top - r.height / 2) * strength * 0.4,
      duration: 0.4,
      ease: "power3",
    });
  };

  const onLeave = () => {
    gsap.to([ref.current, ref.current!.firstElementChild], {
      x: 0,
      y: 0,
      duration: 0.7,
      ease: "elastic.out(1, 0.4)",
    });
  };

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className="inline-block will-change-transform">
      {children}
    </div>
  );
}
