import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const Scene1 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 15], [0, 1]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", backgroundColor: "#111" }}>
      <h1 style={{ color: "white", fontSize: 80, textAlign: "center", opacity }}>
        還在等待渲染嗎？
      </h1>
    </AbsoluteFill>
  );
};
