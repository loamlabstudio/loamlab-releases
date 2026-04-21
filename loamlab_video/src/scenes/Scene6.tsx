import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";
import { TextOverlay } from "../components/TextOverlay";

export const Scene6 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const scale = spring({
    frame,
    fps,
    from: 1.2,
    to: 1,
    config: { damping: 10 }
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Img 
        src={staticFile("multiangle_grid.jpg")} 
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} 
      />
      <TextOverlay text="九宮格鏡頭" subtext="捕捉空間的每一種張力" />
    </AbsoluteFill>
  );
};
