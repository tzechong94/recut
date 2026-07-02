import { useState } from "react";
import "./styles.css";
import { Premise } from "./stages/Premise";
import { Showrunner } from "./Showrunner";

type View =
  | { name: "premise" }
  | { name: "production"; productionId: string };

export default function App() {
  const [view, setView] = useState<View>({ name: "premise" });

  return (
    <div className="rc-root sr">
      {view.name === "premise" && (
        <Premise
          open={(id) => setView({ name: "production", productionId: id })}
        />
      )}
      {view.name === "production" && (
        <Showrunner
          key={view.productionId}
          productionId={view.productionId}
          exit={() => setView({ name: "premise" })}
          open={(id) => setView({ name: "production", productionId: id })}
        />
      )}
    </div>
  );
}
