import { AbsoluteFill, Series, Audio, TransitionSeries, linearTiming, spring } from "remotion";
import { Scene1 } from "./scenes/Scene1";
import { Scene2 } from "./scenes/Scene2";
import { Scene3 } from "./scenes/Scene3";
import { Scene4 } from "./scenes/Scene4";
import { Scene5 } from "./scenes/Scene5";
import { Scene6 } from "./scenes/Scene6";
import { Scene7 } from "./scenes/Scene7";
import { Scene8 } from "./scenes/Scene8";

export const Main = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Series>
        <Series.Sequence durationInFrames={90}>
          <Scene1 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={90}>
          <Scene2 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={90}>
          <Scene3 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={150}>
          <Scene4 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={150}>
          <Scene5 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={150}>
          <Scene6 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={120}>
          <Scene7 />
        </Series.Sequence>
        <Series.Sequence durationInFrames={120}>
          <Scene8 />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
