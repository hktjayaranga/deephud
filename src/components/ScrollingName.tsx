import { CSSProperties, useLayoutEffect, useRef, useState } from "react";

/** Keep HUD labels still when they fit, and loop overflowing names at 20px/s. */
export default function ScrollingName({ text, className }: { text: string; className: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const label = textRef.current!;
    const measure = () => {
      const width = label.getBoundingClientRect().width;
      setDistance(viewport.clientWidth > 0 && width > viewport.clientWidth ? width + 32 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(label);
    return () => observer.disconnect();
  }, [text]);

  const style = {
    "--name-distance": `${-distance}px`,
    "--name-duration": `${distance / 20}s`,
  } as CSSProperties;

  return (
    <div ref={viewportRef} className={`scrolling-name ${className}${distance ? " scrolling-name--overflow" : ""}`} title={text} style={style}>
      <span className="sr-only">{text}</span>
      <span key={text} className="scrolling-name__track" aria-hidden="true">
        <span ref={textRef} className="scrolling-name__text">{text}</span>
        {distance > 0 && <span className="scrolling-name__copy">{text}</span>}
      </span>
    </div>
  );
}
