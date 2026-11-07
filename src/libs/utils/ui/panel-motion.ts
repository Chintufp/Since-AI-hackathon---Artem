/**
 * Port of design-lab/chatgpt/ui/v008/motion.js (critically damped springs, one rAF loop that
 * only runs while something is unsettled). Constants and maths are 1:1; the only change is
 * that registerDetails() may scan a container other than the context reveal, so the result
 * and case timelines reuse the same node springs.
 */
export interface PanelMotionOptions {
  surface: HTMLElement;
  skin: HTMLElement;
  content: HTMLElement;
  footer: HTMLElement;
  canvas: HTMLElement;
  reveal: HTMLElement;
  history: () => HTMLElement | null;
  naturalHeight: () => number;
  reduced: () => boolean;
}

interface Spring {
  value: number;
  target: number;
  velocity: number;
  omega: number;
}

interface Detail {
  el: HTMLElement;
  inner: HTMLElement;
  spring: Spring;
  full: number;
}

export interface PanelMotionStatus {
  active: boolean;
  panelProgress: number;
  panelTarget: number;
  panelVelocity: number;
  contextHeight: number;
  contextTarget: number;
  panelHeight: number;
  viewTransition: boolean;
  detailHeights: Array<{ id: string | undefined; value: number; target: number }>;
}

export interface PanelMotion {
  registerDetails(openId: string | null, container?: HTMLElement): void;
  node(openId: string | null): void;
  context(open: boolean, animate?: boolean): void;
  panel(open: boolean, animate?: boolean): void;
  view(animate?: boolean): void;
  press(down: boolean): void;
  settle(): void;
  status(): PanelMotionStatus;
}

const make = (value: number, omega: number): Spring => ({ value, target: value, velocity: 0, omega });
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));

export function createPanelMotion({ surface, skin, content, footer, canvas, reveal, history, naturalHeight, reduced }: PanelMotionOptions): PanelMotion {
  const panel = make(1, 40);
  const height = make(180, 46);
  const fade = make(1, 48);
  const context = make(0, 44);
  const press = make(0, 60);
  let details: Detail[] = [];
  let contextOpen = false;
  let viewTransition = false;
  let raf = 0;
  let lastTime = 0;

  function step(s: Spring, dt: number): void {
    const d = s.value - s.target;
    const v = s.velocity;
    const b = v + s.omega * d;
    const e = Math.exp(-s.omega * dt);
    s.value = s.target + (d + b * dt) * e;
    s.velocity = (v - s.omega * b * dt) * e;
    const tolerance = s === panel || s === fade ? 0.0008 : 0.12;
    if (Math.abs(s.value - s.target) < tolerance && Math.abs(s.velocity) < tolerance * 30) {
      s.value = s.target;
      s.velocity = 0;
    }
  }
  const unsettled = (s: Spring): boolean => s.value !== s.target || s.velocity !== 0;

  function render(): void {
    details.forEach((d) => {
      d.el.style.height = Math.max(0, Math.round(d.spring.value)) + 'px';
      const ratio = clamp(d.spring.value / d.full);
      d.inner.style.opacity = String(ratio * ratio * (3 - 2 * ratio));
      d.inner.style.visibility = d.spring.value > 0.1 ? '' : 'hidden';
    });
    reveal.style.height = Math.max(0, Math.round(context.value)) + 'px';
    const h = Math.max(2, Math.round(height.value));
    surface.style.height = h + 'px';
    const p = clamp(panel.value);
    const geometry = clamp(p / 0.72);
    const text = clamp((p - 0.72) / 0.28);
    const smooth = text * text * (3 - 2 * text);
    const width = surface.getBoundingClientRect().width;
    surface.style.clipPath = p === 1 ? 'none' : `inset(${Math.round((1 - geometry) * h)}px 0px 0px ${Math.round((1 - geometry) * width * 0.82)}px round 16px)`;
    skin.style.top = Math.round((1 - geometry) * h) + 'px';
    skin.style.left = Math.round((1 - geometry) * width * 0.82) + 'px';
    skin.style.visibility = p === 0 ? 'hidden' : 'visible';
    surface.style.visibility = p === 0 ? 'hidden' : 'visible';
    surface.style.pointerEvents = panel.target === 0 ? 'none' : '';
    content.style.opacity = String(smooth * clamp(fade.value));
    footer.style.opacity = String(smooth);
    content.style.transform = `translateY(${Math.round((1 - smooth * clamp(fade.value)) * 4)}px)`;
    canvas.style.transform = `translateY(${Math.round(clamp(press.value)) * 2}px)`;
    const hist = history();
    if (hist) {
      const box = hist.getBoundingClientRect();
      // Desktop adaptation: once fully revealed every title is visible, so a scrolling history
      // (capped by max-height) never leaves titles hidden below its fold.
      const fullyOpen = context.value >= box.height - 0.5;
      hist.querySelectorAll<HTMLElement>('.rf-node-title').forEach((n) => {
        n.style.visibility = fullyOpen || n.getBoundingClientRect().bottom - box.top <= context.value + 0.5 ? '' : 'hidden';
      });
    }
  }

  function tick(time: number): void {
    const dt = lastTime ? Math.min(0.032, (time - lastTime) / 1000) : 1 / 60;
    lastTime = time;
    if (reduced()) {
      settle();
      return;
    }
    details.forEach((d) => {
      step(d.spring, dt);
      d.el.style.height = Math.max(0, Math.round(d.spring.value)) + 'px';
    });
    const full = history()?.getBoundingClientRect().height || 0;
    context.target = contextOpen ? full : 0;
    if (details.some((d) => unsettled(d.spring)) && contextOpen) {
      context.value = full;
      context.velocity = 0;
    } else step(context, dt);
    reveal.style.height = Math.max(0, Math.round(context.value)) + 'px';
    height.target = Math.ceil(naturalHeight());
    if (viewTransition) {
      step(height, dt);
      if (!unsettled(height)) viewTransition = false;
    } else {
      height.value = height.target;
      height.velocity = 0;
    }
    step(panel, dt);
    step(fade, dt);
    step(press, dt);
    render();
    if ([panel, height, fade, context, press, ...details.map((d) => d.spring)].some(unsettled)) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
      lastTime = 0;
    }
  }

  function schedule(): void {
    if (reduced()) {
      settle();
      return;
    }
    if (!raf) {
      lastTime = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  function settle(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    lastTime = 0;
    details.forEach((d) => {
      d.spring.value = d.spring.target;
      d.spring.velocity = 0;
      d.el.style.height = Math.round(d.spring.value) + 'px';
    });
    context.target = contextOpen ? history()?.getBoundingClientRect().height || 0 : 0;
    context.value = context.target;
    context.velocity = 0;
    reveal.style.height = Math.round(context.value) + 'px';
    height.target = Math.ceil(naturalHeight());
    height.value = height.target;
    height.velocity = 0;
    panel.value = panel.target;
    panel.velocity = 0;
    fade.value = fade.target = 1;
    fade.velocity = 0;
    press.value = press.target = 0;
    press.velocity = 0;
    viewTransition = false;
    render();
  }

  return {
    registerDetails(openId, container = reveal) {
      details = [...container.querySelectorAll<HTMLElement>('.rf-node-detail')].map((el) => {
        const inner = el.firstElementChild as HTMLElement;
        const full = Math.ceil(inner.getBoundingClientRect().height);
        const spring = make(el.dataset.node === openId ? full : 0, 54);
        el.style.height = spring.value + 'px';
        inner.style.visibility = spring.target ? '' : 'hidden';
        return { el, inner, spring, full };
      });
    },
    node(openId) {
      details.forEach((d) => {
        d.full = Math.ceil(d.inner.getBoundingClientRect().height);
        d.spring.target = d.el.dataset.node === openId ? d.full : 0;
        d.el.setAttribute('aria-hidden', String(d.spring.target === 0));
      });
      viewTransition = false;
      schedule();
    },
    context(open, animate = true) {
      contextOpen = open;
      viewTransition = false;
      context.target = open ? history()?.getBoundingClientRect().height || 0 : 0;
      if (animate) schedule();
      else {
        context.value = context.target;
        context.velocity = 0;
        reveal.style.height = Math.round(context.value) + 'px';
      }
    },
    panel(open, animate = true) {
      panel.target = open ? 1 : 0;
      panel.omega = open ? 40 : 49;
      (surface as HTMLElement & { inert: boolean }).inert = !open;
      if (animate) {
        render();
        schedule();
      } else settle();
    },
    view(animate = true) {
      height.target = Math.ceil(naturalHeight());
      if (animate) {
        viewTransition = true;
        fade.value = 0;
        fade.velocity = 0;
        fade.target = 1;
        schedule();
      } else settle();
    },
    press(down) {
      if (reduced()) return;
      press.target = down ? 1 : 0;
      if (down) {
        press.value = 1;
        press.velocity = 0;
        render();
      }
      schedule();
    },
    settle,
    status: () => ({
      active: !!raf,
      panelProgress: panel.value,
      panelTarget: panel.target,
      panelVelocity: panel.velocity,
      contextHeight: context.value,
      contextTarget: context.target,
      panelHeight: height.value,
      viewTransition,
      detailHeights: details.map((d) => ({ id: d.el.dataset.node, value: d.spring.value, target: d.spring.target })),
    }),
  };
}
