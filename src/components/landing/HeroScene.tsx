import { useEffect, useRef } from "react";
import * as THREE from "three";
import { gsap, ScrollTrigger } from "@/lib/gsap";

const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uFlatten;
  attribute float aRandom;
  varying float vElev;
  varying float vDist;

  void main() {
    vec3 pos = position;

    float swell = sin(pos.x * 0.45 + uTime * 0.7)
                * cos(pos.z * 0.35 + uTime * 0.5) * 0.55;
    swell += sin(pos.x * 1.4 - uTime * 0.9) * 0.12;

    float d = distance(pos.xz, uMouse);
    float ripple = sin(d * 2.2 - uTime * 3.0) * exp(-d * 0.45) * 1.1;

    float band = exp(-abs(pos.z) * 0.9);
    float wave = sin(pos.x * 1.8 + uTime * 2.4) * band * (0.8 + aRandom * 0.6);

    pos.y = mix(swell + ripple, wave * 1.4, uFlatten);
    pos.z = mix(pos.z, pos.z * 0.25, uFlatten);

    vElev = pos.y;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + aRandom * 2.4) * (14.0 / vDist);
  }
`;

const FRAG = /* glsl */ `
  varying float vElev;
  varying float vDist;

  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.1, r);

    vec3 teal  = vec3(0.078, 0.722, 0.651);
    vec3 amber = vec3(0.851, 0.467, 0.024);
    vec3 deep  = vec3(0.05, 0.09, 0.12);

    float t = smoothstep(-0.6, 1.2, vElev);
    vec3 col = mix(deep, mix(teal, amber, smoothstep(0.55, 1.0, t)), t + 0.15);

    float fog = smoothstep(26.0, 8.0, vDist);
    gl_FragColor = vec4(col, soft * fog * 0.9);
  }
`;

export function HeroScene({ flattenTriggerId }: { flattenTriggerId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 60);
    camera.position.set(0, 3.2, 9);
    camera.lookAt(0, 0, 0);

    const isSmall = window.innerWidth < 768;
    const COLS = isSmall ? 80 : 160;
    const ROWS = isSmall ? 50 : 100;
    const W = 26;
    const D = 16;
    const count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    let idx = 0;
    for (let x = 0; x < COLS; x++) {
      for (let z = 0; z < ROWS; z++) {
        positions[idx * 3] = (x / (COLS - 1) - 0.5) * W;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = (z / (ROWS - 1) - 0.5) * D;
        randoms[idx] = Math.random();
        idx++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 1));

    const uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(99, 99) },
      uFlatten: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(geo, mat));

    const target = new THREE.Vector2(99, 99);
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const onMove = (e: PointerEvent) => {
      const r = mount.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) target.set(hit.x, hit.z);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const st = ScrollTrigger.create({
      trigger: `#${flattenTriggerId}`,
      start: "top bottom",
      end: "top 30%",
      scrub: 1,
      onUpdate: (self) => {
        uniforms.uFlatten.value = self.progress;
        camera.position.y = 3.2 - self.progress * 2.4;
        camera.position.z = 9 - self.progress * 2.0;
        camera.lookAt(0, 0, 0);
      },
    });

    const clock = new THREE.Clock();
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
    io.observe(mount);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      uniforms.uTime.value = reduced ? 0 : clock.getElapsedTime();
      uniforms.uMouse.value.lerp(target, 0.08);
      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      st.kill();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [flattenTriggerId]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 -z-10"
      aria-hidden
      style={{ maskImage: "linear-gradient(to bottom, black 60%, transparent)" }}
    />
  );
}
