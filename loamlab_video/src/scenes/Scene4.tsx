import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { TextOverlay } from "../components/TextOverlay";

export const Scene4 = () => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  
  // Slide before/after
  const sliderPos = interpolate(frame, [30, 120], [0, width], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* After Image (Background) */}
      <Img src={staticFile("after.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      
      {/* Before Image (Revealed by slider) */}
      <div style={{ 
        position: "absolute", 
        top: 0, 
        left: 0, 
        width: sliderPos, 
        height: "100%", 
        overflow: "hidden",
        borderRight: "4px solid white"
      }}>
        <Img src={staticFile("before.jpg")} style={{ width, height: "100%", objectFit: "cover" }} />
      </div>

      <TextOverlay text="真實渲染" subtext="無需設定，點擊即見未來" />
    </AbsoluteFill>
  );
};
