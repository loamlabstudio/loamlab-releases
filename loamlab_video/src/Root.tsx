import { Composition } from "remotion";
import { Main } from "./Composition";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="LoamLabPromo"
        component={Main}
        durationInFrames={960} // 32 seconds at 30 fps
        fps={30}
        width={1080}
        height={1080}
      />
    </>
  );
};
