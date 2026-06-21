import { useEffect, useRef } from "react";
import * as THREE from "three";
import { gsap } from "@/lib/gsap";

/**
 * WelcomeScene — ambient particle wave for the desktop welcome screen.
 *
 * Inspired by HeroScene, but tuned for a single non-scrolling viewport:
 *  - no ScrollTrigger / no camera flatten on scroll (the welcome screen
 *    is a static full-height page)
 *  - camera framed for a tall vertical panel
 *  - keeps the mouse-ripple interactivity so the surface feels alive
 *  - keeps the resilience patterns (reduced-motion, IntersectionObserver
 *    pause, try/catch around the WebGLRenderer) so a webview without
 *    WebGL degrades gracefully to the CSS gradient beneath it.
 */
const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec2  uMouse;
  attribute float aRandom;
  varying float vElev;
  varying float vDist;

  void main() {
    vec3 pos = position;

    // Soft, slow swell — like breath.
    float swell = sin(pos.x * 0.40 + uTime * 0.6)
                * cos(pos.z * 0.32 + uTime * 0.42) * 0.55;
    swell += sin(pos.x * 1.3 - uTime * 0.8) * 0.10;

    // Mouse ripple radiating outward from the cursor.
    float d = distance(pos.xz, uMouse);
    float ripple = sin(d * 2.0 - uTime * 2.6) * exp(-d * 0.42) * 0.95;

    pos.y = swell + ripple;

    vElev = pos.y;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.4 + aRandom * 2.2) * (14.0 / vDist);
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
    vec3 col = mix(deep, mix(teal, amber, smoothstep(0.55, 1.0, t)), t + 0.12);

    float fog = smoothstep(28.0, 8.0, vDist);
    gl_FragColor = vec4(col, soft * fog * 0.85);
  }
`;

export function WelcomeScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL — the CSS gradient behind us is the graceful fallback
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 60);
    camera.position.set(0, 3.6, 9);
    camera.lookAt(0, 0, 0);

    const isNarrow = mount.clientWidth < 520;
    const COLS = isNarrow ? 70 : 130;
    const ROWS = isNarrow ? 60 : 110;
    const W = 22;
    const D = 18;
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

    // Mouse ripple — raycast onto the y=0 plane to get a world-space target.
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
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // Fade the canvas in once the first frame has painted, so the GPU
    // warm-up never shows as a blank black rectangle.
    gsap.fromTo(renderer.domElement, { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "power2.out" });
    renderer.domElement.style.transition = "opacity 0.3s ease";

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      aria-hidden
      style={{
        maskImage: "linear-gradient(to bottom, black 55%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent)",
      }}
    />
  );
}
