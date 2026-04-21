import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { TextOverlay } from "../components/TextOverlay";

export const Scene7 = () => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  
  const opacity = interpolate(frame, [0, 20], [0, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity }}>
      <Img 
        src={staticFile("hero-bg.jpg")} 
        style={{ width: "100%", height: "100%", objectFit: "cover" }} 
      />
      <div style={{ 
        position: "absolute", 
        top: 0, 
        left: 0, 
        width: "100%", 
        height: "100%", 
        backgroundColor: "rgba(0,0,0,0.3)" 
      }} />
      <TextOverlay text="把時間還給設計" subtext="把驚艷留給客戶" />
    </AbsoluteFill>
  );
};
