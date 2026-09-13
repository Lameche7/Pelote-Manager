import { useCallback, useEffect, useRef, useState } from "react";
import "./TvRemoteNavigation.css";

const HIDE_DELAY_MS = 3_000;

type TvRemoteNavigationProps = {
  onPrevious: () => void;
  onNext: () => void;
};

export function TvRemoteNavigation({
  onPrevious,
  onNext,
}: TvRemoteNavigationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current === null) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const revealTemporarily = useCallback(() => {
    setIsVisible(true);
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setIsVisible(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      revealTemporarily();

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      }
    };

    const handlePointerMove = () => revealTemporarily();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointermove", handlePointerMove);

    return () => {
      clearHideTimer();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [clearHideTimer, onNext, onPrevious, revealTemporarily]);

  return (
    <nav
      className={`tv-remote-navigation${isVisible ? " tv-remote-navigation--visible" : ""}`}
      aria-label="Navigation entre les écrans du Mode TV"
    >
      <button
        className="tv-remote-navigation__button tv-remote-navigation__button--previous"
        type="button"
        aria-label="Écran précédent"
        onClick={() => {
          revealTemporarily();
          onPrevious();
        }}
      >
        ‹
      </button>
      <button
        className="tv-remote-navigation__button tv-remote-navigation__button--next"
        type="button"
        aria-label="Écran suivant"
        onClick={() => {
          revealTemporarily();
          onNext();
        }}
      >
        ›
      </button>
    </nav>
  );
}
