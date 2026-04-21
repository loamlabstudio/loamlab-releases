import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";

export const Scene8 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const moveIn = spring({
    frame,
    fps,
    config: { stiffness: 100 }
  });

  return (
    <AbsoluteFill style={{ 
      justifyContent: "center", 
      alignItems: "center", 
      backgroundColor: "#007AFF",
      color: "white"
    }}>
      <Img 
        src={staticFile("logo.png")} 
        style={{ width: 200, height: 200, marginBottom: 40 }} 
      />
      
      <div style={{ transform: `scale(${moveIn})`, textAlign: "center" }}>
        <h1 style={{ fontSize: 80, margin: 0 }}>立即體驗</h1>
        <p style={{ fontSize: 40, marginTop: 20 }}>loamlab-camera.vercel.app</p>
        
        <div style={{ 
          marginTop: 60, 
          padding: "20px 40px", 
          backgroundColor: "white", 
          color: "#007AFF", 
          fontSize: 50, 
          fontWeight: "bold",
          borderRadius: 20
        }}>
          LOAM_BETA_30
        </div>
        <p style={{ fontSize: 24, marginTop: 10, opacity: 0.8 }}>公測限定 7 折優惠</p>
      </div>
    </AbsoluteFill>
  );
};
