import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";
import { TextOverlay } from "../components/TextOverlay";

export const Scene5 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const opacityAfter = interpolate(frame, [40, 60], [0, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Img src={staticFile("spacereform_before.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <Img src={staticFile("spacereform_after.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", top: 0, left: 0, opacity: opacityAfter }} />
      
      <TextOverlay text="局部換裝" subtext="AI 家具規劃師，一鍵切換風格" />
    </AbsoluteFill>
  );
};
