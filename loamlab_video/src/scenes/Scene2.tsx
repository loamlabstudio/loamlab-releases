import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const Scene2 = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  
  const leftX = interpolate(frame, [0, 20], [-width / 2, 0], { extrapolateRight: "clamp" });
  const rightX = interpolate(frame, [0, 20], [width / 2, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "row", backgroundColor: "#000" }}>
      <div style={{ flex: 1, backgroundColor: "#222", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", transform: `translateX(${leftX}px)` }}>
        <h2 style={{ color: "#888", fontSize: 40 }}>傳統方式</h2>
        <div style={{ color: "#f44", fontSize: 60, fontWeight: "bold" }}>2 小時</div>
      </div>
      <div style={{ flex: 1, backgroundColor: "#007AFF", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", transform: `translateX(${rightX}px)` }}>
        <h2 style={{ color: "white", fontSize: 40 }}>LoamLab</h2>
        <div style={{ color: "white", fontSize: 60, fontWeight: "bold" }}>30 秒</div>
      </div>
    </AbsoluteFill>
  );
};
