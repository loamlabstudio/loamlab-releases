import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const TextOverlay = ({ text, subtext }: { text: string; subtext?: string }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1]);
  const y = interpolate(frame, [0, 10], [20, 0]);

  return (
    <AbsoluteFill style={{ 
      pointerEvents: "none", 
      display: "flex", 
      flexDirection: "column", 
      justifyContent: "flex-end", 
      padding: 60,
      background: "linear-gradient(transparent, rgba(0,0,0,0.8))"
    }}>
      <h2 style={{ color: "white", fontSize: 60, margin: 0, opacity, transform: `translateY(${y}px)` }}>
        {text}
      </h2>
      {subtext && (
        <p style={{ color: "#aaa", fontSize: 30, marginTop: 10, opacity, transform: `translateY(${y}px)` }}>
          {subtext}
        </p>
      )}
    </AbsoluteFill>
  );
};
