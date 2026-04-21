import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";

export const Scene3 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const scale = spring({
    frame,
    fps,
    config: { stiffness: 100 },
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", backgroundColor: "#000" }}>
      <Img 
        src={staticFile("logo.png")} 
        style={{ width: 400, height: 400, transform: `scale(${scale})` }} 
      />
      <div style={{ marginTop: 40, color: "white", fontSize: 60, fontWeight: "bold" }}>
        LoamLab Suite
      </div>
    </AbsoluteFill>
  );
};
