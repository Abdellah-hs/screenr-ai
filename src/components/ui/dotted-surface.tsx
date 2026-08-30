"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type ThreeModule = typeof import("three");

type DottedSurfaceProps = Omit<React.ComponentProps<"div">, "ref"> & {
  /**
   * Dot color scheme: "dark" dots read on light backgrounds, "light" on dark
   * ones. A prop rather than a theme hook — the app has no theme provider, and
   * the surfaces this decorates (e.g. the apply brand panel) have a fixed tone.
   */
  dots?: "light" | "dark";
};

/**
 * Builds the scene and starts the animation. Returns its own teardown.
 *
 * Split out of the component so the effect can `await import("three")` first
 * and hand the module in — every three.js reference lives here.
 */
function startSurface(
  THREE: ThreeModule,
  container: HTMLDivElement,
  dots: "light" | "dark",
): () => void {
  const SEPARATION = 150;
  const AMOUNTX = 40;
  const AMOUNTY = 60;

  // Fog matches the backdrop tone so distant dots fade out instead of
  // popping; the renderer itself stays transparent (alpha 0 clear).
  const fogColor = dots === "light" ? 0x161c3d : 0xffffff;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(fogColor, 2000, 10000);

  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;

  const camera = new THREE.PerspectiveCamera(60, width / height, 1, 10000);
  camera.position.set(0, 355, 1220);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.setClearColor(fogColor, 0);
  container.appendChild(renderer.domElement);

  const positions: number[] = [];
  const colors: number[] = [];
  const shade = dots === "light" ? 1 : 0;

  for (let ix = 0; ix < AMOUNTX; ix++) {
    for (let iy = 0; iy < AMOUNTY; iy++) {
      positions.push(
        ix * SEPARATION - (AMOUNTX * SEPARATION) / 2,
        0, // animated below
        iy * SEPARATION - (AMOUNTY * SEPARATION) / 2,
      );
      colors.push(shade, shade, shade);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 8,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  let animationId = 0;
  let count = 0;

  // The two sine bands are crossed, so each depends on one axis only. Computed
  // inside the inner loop that is 2 x AMOUNTX x AMOUNTY = 4800 `Math.sin` calls
  // a frame — 288k a second at 60fps — for 100 distinct values. Hoisted, and
  // the per-row band reuses one buffer rather than allocating per frame.
  const rowBand = new Float32Array(AMOUNTY);

  const animate = () => {
    animationId = requestAnimationFrame(animate);

    const positionAttribute = geometry.attributes.position;
    const pos = positionAttribute.array as Float32Array;

    for (let iy = 0; iy < AMOUNTY; iy++) {
      rowBand[iy] = Math.sin((iy + count) * 0.5) * 50;
    }

    let i = 0;
    for (let ix = 0; ix < AMOUNTX; ix++) {
      const columnBand = Math.sin((ix + count) * 0.3) * 50;
      for (let iy = 0; iy < AMOUNTY; iy++) {
        pos[i * 3 + 1] = columnBand + rowBand[iy];
        i++;
      }
    }

    positionAttribute.needsUpdate = true;
    renderer.render(scene, camera);
    count += 0.1;
  };

  const handleResize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);

  animate();

  return () => {
    cancelAnimationFrame(animationId);
    resizeObserver.disconnect();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  };
}

/**
 * Animated waving grid of dots (three.js), rendered behind content as a purely
 * decorative layer. Fills and resizes with its nearest positioned ancestor, so
 * it works inside a rounded overflow-hidden panel as well as full-screen.
 *
 * three.js is imported **inside the effect**, not at module scope. It is ~600KB
 * for a decoration on the one page a candidate has to fill in a form on, and a
 * static import puts it in that page's initial bundle — so the apply form was
 * waiting to become interactive behind an animation nobody applied for. Loading
 * it after mount costs the dots a moment of absence and nothing else.
 */
export function DottedSurface({ className, dots = "dark", ...props }: DottedSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    void import("three").then((THREE) => {
      // Unmounted (or `dots` changed) while the chunk was in flight — building
      // a WebGL context now would leak one with nothing left to dispose it.
      if (disposed) return;
      teardown = startSurface(THREE, container, dots);
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [dots]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      {...props}
    />
  );
}
