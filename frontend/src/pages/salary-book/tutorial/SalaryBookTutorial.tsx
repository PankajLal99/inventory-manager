import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lightbulb, X } from 'lucide-react';
import { setSalaryBookTutorialRunning } from './activeFlag';
import {
  clearSalaryBookTutorialSeen,
  hasSeenSalaryBookTutorial,
  markSalaryBookTutorialSeen,
} from './storage';
import { SALARY_BOOK_TUTORIAL_STEPS, type TutorialStep } from './steps';

type Rect = { top: number; left: number; width: number; height: number };

interface TutorialContextValue {
  active: boolean;
  start: () => void;
  skip: () => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useSalaryBookTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useSalaryBookTutorial must be used within SalaryBookTutorialProvider');
  }
  return ctx;
}

/** Safe hook for settings page — returns null outside provider. */
export function useSalaryBookTutorialOptional() {
  return useContext(TutorialContext);
}

function isDesktopNav() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
}

function isNarrowViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
}

function viewportSize() {
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
    offsetTop: vv?.offsetTop ?? 0,
    offsetLeft: vv?.offsetLeft ?? 0,
  };
}

function findTarget(id: string): HTMLElement | null {
  const nodes = document.querySelectorAll(`[data-tutorial="${id}"]`);
  for (const node of nodes) {
    const el = node as HTMLElement;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    let parent: HTMLElement | null = el.parentElement;
    let hiddenAncestor = false;
    while (parent) {
      const ps = window.getComputedStyle(parent);
      if (ps.display === 'none') {
        hiddenAncestor = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (hiddenAncestor) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) continue;
    return el;
  }
  return null;
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

interface ProviderProps {
  children: ReactNode;
  userId?: number | null;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
}

export function SalaryBookTutorialProvider({
  children,
  userId,
  moreOpen,
  setMoreOpen,
}: ProviderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const waitRef = useRef(0);
  const autoStartedForUser = useRef<number | null>(null);
  const prevUserId = useRef<number | null | undefined>(undefined);

  const steps = useMemo(() => {
    const desktop = isDesktopNav();
    return SALARY_BOOK_TUTORIAL_STEPS.filter((s) => !(s.mobileOnly && desktop));
  }, [active]);

  const step: TutorialStep | undefined = active ? steps[index] : undefined;
  const total = steps.length;

  const finish = useCallback(() => {
    markSalaryBookTutorialSeen(userId);
    setSalaryBookTutorialRunning(false);
    setActive(false);
    setIndex(0);
    setRect(null);
    setReady(false);
    setMoreOpen(false);
    window.dispatchEvent(new Event('sb-tutorial-finished'));
  }, [setMoreOpen, userId]);

  const start = useCallback(() => {
    clearSalaryBookTutorialSeen(userId);
    setSalaryBookTutorialRunning(true);
    setIndex(0);
    setActive(true);
    setReady(false);
    setRect(null);
  }, [userId]);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  useEffect(() => {
    setSalaryBookTutorialRunning(active);
    return () => setSalaryBookTutorialRunning(false);
  }, [active]);

  // Lock page scroll while the tour is open (especially important on iOS).
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  // When the logged-in salary-book user changes, reset tour state for the new account.
  useEffect(() => {
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      setActive(false);
      setIndex(0);
      setRect(null);
      setReady(false);
      setMoreOpen(false);
      autoStartedForUser.current = null;
    }
    prevUserId.current = userId ?? null;
  }, [userId, setMoreOpen]);

  // Auto-start once per user account that has not seen/skipped the tour.
  useEffect(() => {
    if (!userId) return;
    if (hasSeenSalaryBookTutorial(userId)) return;
    if (autoStartedForUser.current === userId) return;
    autoStartedForUser.current = userId;
    const t = window.setTimeout(() => {
      setSalaryBookTutorialRunning(true);
      setActive(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [userId]);

  useEffect(() => {
    if (!active || !step) return;

    const desktop = isDesktopNav();
    const needsMore = Boolean(step.openMore) && !desktop;

    if (needsMore) {
      setMoreOpen(true);
    } else if (moreOpen && !step.openMore) {
      setMoreOpen(false);
    }

    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [active, step, location.pathname, navigate, moreOpen, setMoreOpen]);

  useLayoutEffect(() => {
    if (!active || !step) return;

    setReady(false);
    setRect(null);
    const token = ++waitRef.current;

    if (!step.target || step.placement === 'center') {
      setReady(true);
      setRect(null);
      return;
    }

    let attempts = 0;
    const maxAttempts = 50;

    const tick = () => {
      if (waitRef.current !== token) return;
      const el = findTarget(step.target!);
      if (el) {
        const inFixedChrome =
          step.target!.startsWith('nav-') || Boolean(step.openMore);
        el.scrollIntoView({
          block: inFixedChrome ? 'nearest' : 'center',
          inline: 'nearest',
          behavior: 'auto',
        });
        // Remeasure after scroll / More sheet animation.
        window.requestAnimationFrame(() => {
          if (waitRef.current !== token) return;
          const latest = findTarget(step.target!);
          if (latest) {
            setRect(measure(latest));
            setReady(true);
          } else {
            setRect(null);
            setReady(true);
          }
        });
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tick, 60);
      } else {
        setRect(null);
        setReady(true);
      }
    };

    const delay = step.openMore && !isDesktopNav() ? 220 : 100;
    const id = window.setTimeout(tick, delay);
    return () => window.clearTimeout(id);
  }, [active, step, location.pathname, moreOpen, index]);

  useEffect(() => {
    if (!active || !step?.target || !ready) return;
    const update = () => {
      const el = findTarget(step.target!);
      if (el) setRect(measure(el));
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [active, step, ready]);

  const goNext = () => {
    if (index >= total - 1) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  };

  const goBack = () => {
    if (index <= 0) return;
    setIndex((i) => i - 1);
  };

  const value = useMemo(() => ({ active, start, skip }), [active, start, skip]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {active && step && ready && (
        <TutorialOverlay
          step={step}
          index={index}
          total={total}
          rect={rect}
          moreOpen={moreOpen}
          onNext={goNext}
          onBack={goBack}
          onSkip={skip}
        />
      )}
    </TutorialContext.Provider>
  );
}

function TutorialOverlay({
  step,
  index,
  total,
  rect,
  moreOpen,
  onNext,
  onBack,
  onSkip,
}: {
  step: TutorialStep;
  index: number;
  total: number;
  rect: Rect | null;
  moreOpen: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const pad = 6;
  const highlight = rect
    ? {
        top: Math.max(0, rect.top - pad),
        left: Math.max(0, rect.left - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const cardStyle = useMemo((): CSSProperties => {
    const { width: vw, height: vh } = viewportSize();
    const narrow = isNarrowViewport();
    const side = narrow ? 12 : 16;
    const safeBottom = 'max(12px, env(safe-area-inset-bottom, 0px))';
    const safeTop = 'max(12px, env(safe-area-inset-top, 0px))';

    // Centered intro / missing target / desktop floating fallback for center steps.
    if (!highlight || step.placement === 'center') {
      if (narrow) {
        return {
          left: side,
          right: side,
          bottom: safeBottom,
          top: 'auto',
          maxHeight: `min(70dvh, ${Math.round(vh * 0.7)}px)`,
          width: 'auto',
        };
      }
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: Math.min(360, vw - 32),
        maxHeight: Math.round(vh * 0.8),
      };
    }

    const highlightMid = highlight.top + highlight.height / 2;
    const inLowerThird = highlightMid > vh * 0.55;
    const isNavTarget = Boolean(step.target?.startsWith('nav-')) || moreOpen;

    // Mobile: dock as a sheet opposite the highlight so it never covers bottom nav / More sheet.
    if (narrow) {
      if (inLowerThird || isNavTarget) {
        return {
          left: side,
          right: side,
          top: safeTop,
          bottom: 'auto',
          maxHeight: `min(55dvh, ${Math.round(vh * 0.55)}px)`,
          width: 'auto',
        };
      }
      return {
        left: side,
        right: side,
        bottom: safeBottom,
        top: 'auto',
        maxHeight: `min(55dvh, ${Math.round(vh * 0.55)}px)`,
        width: 'auto',
      };
    }

    // Desktop: float near the target, flip if needed.
    const gap = 14;
    const cardW = Math.min(360, vw - 32);
    const preferBottom =
      step.placement === 'bottom' ||
      (step.placement !== 'top' && !inLowerThird);
    const approxH = Math.min(280, vh * 0.45);
    let top = preferBottom ? highlight.top + highlight.height + gap : highlight.top - gap - approxH;
    if (top < 12) top = highlight.top + highlight.height + gap;
    if (top + approxH > vh - 12) top = Math.max(12, highlight.top - gap - approxH);
    const left = clamp(highlight.left + highlight.width / 2 - cardW / 2, 16, vw - cardW - 16);

    return {
      top,
      left,
      width: cardW,
      maxHeight: Math.round(vh * 0.7),
    };
  }, [highlight, step.placement, step.target, moreOpen]);

  const isLast = index === total - 1;
  const narrow = isNarrowViewport();

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-tutorial-title"
    >
      <div
        className="absolute inset-0 pointer-events-auto touch-none"
        onClick={onSkip}
        onTouchMove={(e) => e.preventDefault()}
      >
        {highlight ? (
          <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <mask id="sb-tutorial-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={highlight.left}
                  y={highlight.top}
                  width={highlight.width}
                  height={highlight.height}
                  rx={narrow ? 12 : 14}
                  fill="black"
                />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.58)" mask="url(#sb-tutorial-mask)" />
            <rect
              x={highlight.left}
              y={highlight.top}
              width={highlight.width}
              height={highlight.height}
              rx={narrow ? 12 : 14}
              fill="none"
              stroke="rgb(5, 150, 105)"
              strokeWidth="2.5"
              className="pointer-events-none"
            />
          </svg>
        ) : (
          <div className="absolute inset-0 bg-slate-900/55" />
        )}
      </div>

      <div
        className={`absolute z-[81] pointer-events-auto bg-white shadow-xl border border-emerald-100 flex flex-col ${
          narrow
            ? 'rounded-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
            : 'rounded-2xl p-4'
        }`}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <Lightbulb className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                Step {index + 1} of {total}
              </p>
              <h2 id="sb-tutorial-title" className="font-semibold text-gray-900 leading-snug text-[15px] sm:text-base">
                {step.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="p-2 -mr-1 text-gray-400 hover:text-gray-600 min-h-10 min-w-10 flex items-center justify-center"
            aria-label="Skip tutorial"
            onClick={onSkip}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 overflow-y-auto overscroll-contain min-h-0 flex-1 [-webkit-overflow-scrolling:touch]">
          <p className="text-sm text-gray-600 leading-relaxed">{step.body}</p>

          {step.notes && step.notes.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {step.notes.map((note) => (
                <li key={note} className="text-xs text-gray-500 flex gap-2">
                  <span className="text-emerald-600 font-bold shrink-0">·</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-sm text-gray-500 px-2 py-2 min-h-11"
            onClick={onSkip}
          >
            Skip
          </button>
          <div className="flex-1" />
          {index > 0 && (
            <button
              type="button"
              className="min-h-11 px-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700"
              onClick={onBack}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="min-h-11 px-5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 active:bg-emerald-800"
            onClick={onNext}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
